import { route } from "@/lib/api/route";
import { autoSchedule, boardView } from "@/lib/desk/board";
import { loadDesk, loadSettings } from "@/lib/desk/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Marlow books unscheduled disputes (deterministic scheduler) and explains what it booked. */
export const POST = route(
  "Board: Marlow schedules work",
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as { reflow?: boolean; explain?: boolean };
    const outcome = await autoSchedule({ reflow: Boolean(body.reflow), explain: body.explain !== false });
    const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
    return { board: boardView(desk, settings), placements: outcome.placements, note: outcome.note };
  },
  { ai: true },
);
