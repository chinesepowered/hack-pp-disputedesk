import { route } from "@/lib/api/route";
import { boardView } from "@/lib/desk/board";
import { syncDesk } from "@/lib/desk/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Intake: poll PayPal for disputes, update the desk, return the board. */
export const GET = route("Intake: poll disputes", async () => {
  const { desk, settings, newIds, changedIds } = await syncDesk();
  return { board: boardView(desk, settings), newIds, changedIds };
});
