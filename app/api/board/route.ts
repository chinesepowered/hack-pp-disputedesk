import { route } from "@/lib/api/route";
import { boardView } from "@/lib/desk/board";
import { syncDesk } from "@/lib/desk/sync";
import { replayAvailable, replayCases } from "@/lib/replay/engine";

const POOL_LOW = 3;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Intake: poll PayPal for disputes, update the desk, return the board. */
export const GET = route("Intake: poll disputes", async (_req, ctx) => {
  const { desk, settings, newIds, changedIds } = await syncDesk();
  const board = boardView(desk, settings);
  // The hosted demo uses disputes up: each can only be filed once. When few are left that
  // still need a response, the UI offers the recorded cases in Replay and says so.
  const untouched = board.cases.filter((c) => c.needsSeller).length;
  const pool = {
    untouched,
    low: ctx.mode === "live" && untouched < POOL_LOW,
    replayCases: replayAvailable() ? replayCases() : [],
  };
  return { board, newIds, changedIds, pool };
});
