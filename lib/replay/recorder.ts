/**
 * Recorder for Replay fixtures. When DISPUTEDESK_RECORD is set (local development only), every
 * live PayPal response and every model output is appended to .data/recordings/tape.jsonl.
 * `pnpm replay:record` turns that tape into the fixtures under fixtures/replay/.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type TapeEntry =
  | { t: string; kind: "rest" | "sdk"; method: string; path: string; status: number; debugId: string | null; ms: number; response: unknown; request?: unknown }
  | { t: string; kind: "ai"; key: string; aiKind: string; model: string; text: string; fallback?: boolean };

const enabled = () => Boolean(process.env.DISPUTEDESK_RECORD) && !process.env.VERCEL;
let ready = false;
const file = () => path.join(process.cwd(), ".data", "recordings", "tape.jsonl");

type WithoutTime<T> = T extends unknown ? Omit<T, "t"> : never;

export function record(entry: WithoutTime<TapeEntry>): void {
  if (!enabled()) return;
  try {
    if (!ready) {
      mkdirSync(path.dirname(file()), { recursive: true });
      ready = true;
    }
    appendFileSync(file(), `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // Recording must never break a request.
  }
}
