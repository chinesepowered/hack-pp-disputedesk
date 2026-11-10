import { route } from "@/lib/api/route";
import { boardView, moveBlock, unscheduleBlock } from "@/lib/desk/board";
import { DeskError } from "@/lib/desk/filing";
import { loadDesk, loadSettings } from "@/lib/desk/state";

export const dynamic = "force-dynamic";

/** A person dragged, dropped or resized a block. It is pinned and the rest reflows around it. */
export const PUT = route("Board: move a work block", async (req) => {
  const body = (await req.json().catch(() => null)) as { disputeId?: string; resourceId?: string; start?: string; end?: string } | null;
  if (!body?.disputeId || !body.resourceId || !body.start || !body.end) {
    throw new DeskError(422, "BAD_BLOCK", "A block needs a dispute, a person, a start and an end.");
  }
  if (Number.isNaN(Date.parse(body.start)) || Number.isNaN(Date.parse(body.end))) {
    throw new DeskError(422, "BAD_BLOCK", "The block's start or end is not a valid time.");
  }
  let outcome;
  try {
    outcome = await moveBlock({ disputeId: body.disputeId, resourceId: body.resourceId, start: body.start, end: body.end });
  } catch (err) {
    throw new DeskError(404, "UNKNOWN_BLOCK", err instanceof Error ? err.message : "Unknown block.");
  }
  const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
  return { board: boardView(desk, settings), placements: outcome.placements, note: outcome.note };
});

/** Take a dispute off the timeline (it goes back to the Unscheduled panel). */
export const DELETE = route("Board: unschedule a work block", async (req) => {
  const disputeId = new URL(req.url).searchParams.get("disputeId");
  if (!disputeId) throw new DeskError(422, "BAD_BLOCK", "Which dispute?");
  const desk = await unscheduleBlock(disputeId);
  return { board: boardView(desk, await loadSettings()) };
});
