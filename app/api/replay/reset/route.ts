import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { wipeDeskState } from "@/lib/desk/state";
import { replayAvailable, replayCases, resetReplaySession } from "@/lib/replay/engine";

export const dynamic = "force-dynamic";

/** Start this browser session's replay over from the first recorded state. */
export const POST = route("Replay: start the recording over", async (_req, ctx) => {
  if (ctx.mode !== "replay") throw new DeskError(409, "NOT_REPLAY", "Switch to Replay first. This never touches the live desk.");
  await wipeDeskState(`replay-${ctx.sessionId}-`);
  await resetReplaySession();
  return { reset: true, cases: replayAvailable() ? replayCases() : [] };
});
