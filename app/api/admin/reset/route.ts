import { timingSafeEqual } from "node:crypto";
import { route } from "@/lib/api/route";
import { autoSchedule, boardView } from "@/lib/desk/board";
import { DeskError } from "@/lib/desk/filing";
import { loadDesk, loadSettings, saveSettings, wipeDeskState } from "@/lib/desk/state";
import { syncDesk } from "@/lib/desk/sync";
import { DEFAULT_SETTINGS } from "@/lib/desk/types";
import { env } from "@/lib/env";
import { deleteDoc } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function tokenOk(given: string | null): boolean {
  const expected = env.adminToken;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Restores the seeded demo state: clears the desk's own working state (blocks, drafts, trails,
 * settings) and rebuilds it from PayPal. It cannot un-resolve a dispute: PayPal is the source
 * of truth, so resolved cases stay resolved and the pool is topped up with `pnpm seed --batch`.
 */
export const POST = route("Admin: reset demo state", async (req) => {
  if (!env.adminToken) throw new DeskError(503, "RESET_DISABLED", "DEMO_ADMIN_TOKEN is not set on this deployment.");
  if (!tokenOk(req.headers.get("x-admin-token"))) throw new DeskError(401, "BAD_TOKEN", "Missing or wrong x-admin-token.");
  const removed = await wipeDeskState();
  await deleteDoc("webhook-events");
  await saveSettings(DEFAULT_SETTINGS);
  const { newIds } = await syncDesk({ feature: "Admin reset: re-read disputes" });
  await autoSchedule({ explain: false });
  const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
  const board = boardView(desk, settings);
  return {
    reset: true,
    removedDocuments: removed,
    disputes: board.cases.length,
    untouched: board.cases.filter((c) => c.needsSeller).length,
    resolved: board.resolved.length,
    rebuilt: newIds.length,
  };
});
