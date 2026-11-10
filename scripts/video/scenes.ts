/**
 * The demo video, scene by scene: what is said and what kind of picture goes with it.
 * `clip` scenes are recordings of the real app against the PayPal sandbox (scripts/video/record.ts).
 * `card` scenes are rendered from HTML (scripts/video/cards.tsx).
 */
import type { MarlowLine } from "@/lib/client/voice-lines";

export type Scene = {
  id: string;
  kind: "clip" | "card";
  title: string;
  narration: string;
  /** One of Marlow's pre-rendered lines, mixed in quietly at this many seconds into the scene. */
  marlow?: { line: MarlowLine; at: number };
  /** Seconds of the recording to skip before the scene starts (page load, setup). */
  skip?: number;
  /** Extra seconds held after the narration ends. */
  tail?: number;
};

export const SCENES: Scene[] = [
  {
    id: "s01-open",
    kind: "clip",
    title: "Cold open: a dispute lands",
    narration:
      "Tuesday morning at Juniper and Moss, a three person plant shop. A customer says a one hundred eighty four dollar fiddle leaf fig never arrived. PayPal has opened a claim, and the clock is running.",
  },
  {
    id: "s02-problem",
    kind: "card",
    title: "Who it is for",
    narration:
      "Small sellers lose disputes they could win. Nobody owns them, so the deadline slips, or the wrong evidence goes in. A lost claim can cost the sale, the goods and a dispute fee.",
  },
  {
    id: "s03-board",
    kind: "clip",
    title: "The triage board",
    narration:
      "Dispute Desk pulls every dispute from PayPal's Disputes API onto one board. Marlow, the desk's clerk, reads each case and books the work into free time before its deadline, inside each person's working hours. The board is a Bryntum Scheduler. Drag a block to reassign it, and Marlow reflows the rest.",
  },
  {
    id: "s04-case",
    kind: "clip",
    title: "The case file",
    narration:
      "Open the case. Marlow has pulled the order, the capture and the tracking from PayPal, and the shop's own records: carrier scans, the signature, and a delivery photo that a vision model confirms shows a parcel at the door. A fixed table says what this claim needs. Rules, not the model, set the win estimate at ninety five percent. Marlow writes the response and builds the evidence pack.",
  },
  {
    id: "s05-file",
    kind: "clip",
    title: "Approve and file",
    narration: "The owner reads it and approves. It goes to PayPal's provide evidence endpoint with the pack attached. Three clicks from a new dispute to a filed response.",
    marlow: { line: "filed", at: 10.6 },
    // The filing is shown in real time (about seven seconds), so this scene runs past its narration.
    tail: 5.6,
  },
  {
    id: "s06-settle",
    kind: "clip",
    title: "PayPal settles it",
    narration: "In the sandbox we can play PayPal's reviewer and settle the claim. The hold on the money is released. Won: one hundred eighty four dollars recovered.",
    marlow: { line: "won", at: 9.9 },
    // Runs past the narration so the Recovered this month counter is on screen.
    tail: 5.4,
  },
  {
    id: "s07-offer",
    kind: "clip",
    title: "Second case: a partial refund offer",
    narration:
      "Not every case should be fought. This planter looked bigger in the listing, and the listing has no size chart. The rules say offer, so Marlow proposes a thirty one dollar partial refund. One approval sends it, the buyer accepts in PayPal, and the case closes with half the sale kept.",
    tail: 3.4,
  },
  {
    id: "s08-prevent",
    kind: "clip",
    title: "Prevention",
    narration: "Then Marlow looks across cases. Two disputes on the same planter. The fix: add a size chart. That is the dispute you never get.",
  },
  {
    id: "s09-guard",
    kind: "clip",
    title: "Guardrails and one honest limit",
    narration:
      "Money decisions stay in code. Every action is checked against the owner's thresholds, and against PayPal's own list of what is allowed. One honest limit: the win estimate comes from fixed rules, not from past outcomes, and the sandbox makes you wait almost half an hour before a claim can be settled. We cut that wait.",
  },
  {
    id: "s10-end",
    kind: "card",
    title: "End card",
    narration: "Dispute Desk. Marlow keeps calm when a chargeback lands.",
    tail: 1.6,
  },
];
