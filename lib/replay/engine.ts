/**
 * Replay mode: the main flow from recorded, real PayPal sandbox and model responses.
 *
 * fixtures/replay/tape.json holds, per dispute, a tape in the order things really happened:
 * a state (the dispute as PayPal returned it), then a POST the desk made with PayPal's real
 * answer and PayPal-Debug-Id, then the next state, and so on. Replay walks that tape:
 *
 * - a GET returns the current state;
 * - a POST is accepted only if it is the next recorded action, and moves to the state that
 *   followed it;
 * - changes PayPal made by itself (a claim becoming ready to settle, a settlement landing) took
 *   minutes in the sandbox and are played a few seconds apart here.
 *
 * Timestamps are shifted so deadlines sit the same distance in the future as when recorded.
 * Replay state is per browser session and never touches the live desk or PayPal.
 */
import fixture from "@/fixtures/replay/tape.json";
import type { AiTag } from "@/lib/desk/types";
import { getDoc, setDoc, withLock } from "@/lib/store";
import { PayPalError, type PayPalRequest, type PayPalResponse } from "@/lib/paypal/http";
import { currentSessionId, recordCall } from "@/lib/paypal/log";
import type { Dispute } from "@/lib/paypal/types";

type StateItem = { type: "state"; dispute: Dispute; debugId: string | null; ms: number };
type PostItem = { type: "post"; action: string; outcome?: string; status: number; response: unknown; debugId: string | null; ms: number };
type TapeItem = StateItem | PostItem;
type SdkItem = { status: number; debugId: string | null; ms: number; response: unknown };
type AiItem = { model: string; text: string; kind: AiTag["kind"]; fallback?: boolean };

export type ReplayFixture = {
  recordedAt: string | null;
  note?: string;
  disputes: Record<string, { label: string; tape: TapeItem[] }>;
  sdk: Record<string, SdkItem>;
  ai: Record<string, AiItem>;
};

const tape = fixture as unknown as ReplayFixture;

/** Seconds between changes PayPal made by itself. In the sandbox these took minutes. */
const AUTO_ADVANCE_MS = 7000;

type Session = { startedAt: number; delta: number; pos: Record<string, number>; changedAt: Record<string, number> };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function shift<T>(value: T, delta: number): T {
  if (typeof value === "string") return (ISO.test(value) ? new Date(new Date(value).getTime() + delta).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => shift(v, delta)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, delta)])) as T;
  return value;
}

export function replayAvailable(): boolean {
  return Object.keys(tape.disputes).length > 0;
}

export function replayCases(): { disputeId: string; label: string }[] {
  return Object.entries(tape.disputes).map(([disputeId, d]) => ({ disputeId, label: d.label }));
}

async function loadSession(): Promise<Session> {
  const key = `replay-${currentSessionId()}-engine`;
  const existing = await getDoc<Session>(key);
  if (existing) return existing;
  const recordedAt = tape.recordedAt ? new Date(tape.recordedAt).getTime() : Date.now();
  const fresh: Session = { startedAt: Date.now(), delta: Date.now() - recordedAt, pos: {}, changedAt: {} };
  await setDoc(key, fresh);
  return fresh;
}

async function saveSession(session: Session): Promise<void> {
  await setDoc(`replay-${currentSessionId()}-engine`, session);
}

/**
 * Read, change and save this browser session's place in the tape as one step. The board and a
 * case file ask at the same moment; without this one of them would overwrite the other's move.
 */
async function withSession<T>(fn: (session: Session) => T): Promise<T> {
  return withLock(`replay-session:${currentSessionId()}`, async () => {
    const session = await loadSession();
    const result = fn(session);
    await saveSession(session);
    return result;
  });
}

/** Forget this session's replay progress (the Replay "start over" button). */
export async function resetReplaySession(): Promise<void> {
  const recordedAt = tape.recordedAt ? new Date(tape.recordedAt).getTime() : Date.now();
  await withLock(`replay-session:${currentSessionId()}`, () => saveSession({ startedAt: Date.now(), delta: Date.now() - recordedAt, pos: {}, changedAt: {} }));
}

function firstState(items: TapeItem[]): number {
  return Math.max(0, items.findIndex((i) => i.type === "state"));
}

/** Move past changes PayPal made by itself, one at a time, a few seconds apart. */
function advance(session: Session, id: string, items: TapeItem[]): boolean {
  const pos = session.pos[id] ?? firstState(items);
  const next = items[pos + 1];
  const last = session.changedAt[id] ?? session.startedAt;
  if (next?.type === "state" && Date.now() - last >= AUTO_ADVANCE_MS) {
    session.pos[id] = pos + 1;
    session.changedAt[id] = Date.now();
    return true;
  }
  if (session.pos[id] === undefined) session.pos[id] = pos;
  return false;
}

function stateAt(session: Session, id: string): StateItem {
  const items = tape.disputes[id].tape;
  const item = items[session.pos[id] ?? firstState(items)];
  return item.type === "state" ? item : (items.find((i) => i.type === "state") as StateItem);
}

/** The next recorded action for a dispute, so the UI can say what the recording covers. */
export async function replayNextAction(id: string): Promise<string | null> {
  const entry = tape.disputes[id];
  if (!entry) return null;
  const session = await loadSession();
  const pos = session.pos[id] ?? firstState(entry.tape);
  const next = entry.tape.slice(pos + 1).find((i) => i.type === "post") as PostItem | undefined;
  if (!next) return null;
  return next.outcome ? `${next.action} (${next.outcome})` : next.action;
}

const DISPUTE_PATH = /^\/v1\/customer\/disputes(?:\/([^/?]+))?(?:\/([a-z-]+))?/;

function notRecorded(what: string): PayPalError {
  return new PayPalError({
    status: 422,
    code: "REPLAY_NOT_RECORDED",
    issue: "REPLAY_NOT_RECORDED",
    message: `Replay has no recording for ${what}. Switch to Live sandbox to do this for real.`,
  });
}

export async function replayRequest<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
  const path = req.path;
  const reply = (data: unknown, status: number, debugId: string | null, ms: number): PayPalResponse<T> => {
    recordCall({ method: req.method, path, status, debugId, ms, via: path.startsWith("/v1/customer/disputes") ? "rest" : "sdk", feature: req.feature, replay: true });
    return { data: data as T, status, debugId };
  };

  const match = path.match(DISPUTE_PATH);
  if (match) {
    const [, id, action] = match;

    if (!id) {
      // List: every recorded dispute at its current point in the tape.
      const items = await withSession((session) =>
        Object.keys(tape.disputes).map((key) => {
          advance(session, key, tape.disputes[key].tape);
          const d = shift(stateAt(session, key).dispute, session.delta);
          return {
            dispute_id: d.dispute_id,
            create_time: d.create_time,
            update_time: d.update_time,
            reason: d.reason,
            status: d.status,
            dispute_state: d.dispute_state,
            dispute_amount: d.dispute_amount,
            dispute_life_cycle_stage: d.dispute_life_cycle_stage,
            seller_response_due_date: d.seller_response_due_date,
            links: (d.links ?? []).filter((l) => l.rel === "self"),
          };
        }),
      );
      return reply({ items, links: [] }, 200, null, 180);
    }

    const entry = tape.disputes[id];
    if (!entry) throw new PayPalError({ status: 404, code: "RESOURCE_NOT_FOUND", message: "This dispute is not part of the recording.", issue: "INVALID_RESOURCE_ID" });

    if (req.method === "GET") {
      const { item, delta } = await withSession((session) => {
        advance(session, id, entry.tape);
        return { item: stateAt(session, id), delta: session.delta };
      });
      return reply(shift(item.dispute, delta), 200, item.debugId, item.ms);
    }

    // A write: only the next recorded action is accepted.
    const wanted = (action ?? "").replace(/-/g, "_");
    const outcome = (req.json as { adjudication_outcome?: string } | undefined)?.adjudication_outcome;
    const played = await withSession((session) => {
      const pos = session.pos[id] ?? firstState(entry.tape);
      const nextIndex = entry.tape.findIndex((i, n) => n > pos && i.type === "post");
      const next = nextIndex >= 0 ? (entry.tape[nextIndex] as PostItem) : null;
      if (!next || next.action !== wanted || (next.outcome && outcome && next.outcome !== outcome)) return { next, accepted: false };
      const after = entry.tape.findIndex((i, n) => n > nextIndex && i.type === "state");
      session.pos[id] = after >= 0 ? after : pos;
      session.changedAt[id] = Date.now();
      return { next, accepted: true };
    });
    const next = played.next;
    if (!played.accepted || !next) {
      const covers = next ? `The recording's next step for this case is "${next.action.replace(/_/g, " ")}${next.outcome ? ` (${next.outcome.toLowerCase().replace(/_/g, " ")})` : ""}".` : "The recording for this case ends here.";
      recordCall({ method: req.method, path, status: 422, debugId: null, ms: 5, via: "rest", feature: req.feature, replay: true });
      throw new PayPalError({ status: 422, code: "REPLAY_NOT_RECORDED", issue: "REPLAY_NOT_RECORDED", message: `Replay only plays what was recorded. ${covers}` });
    }
    return reply(next.response ?? {}, next.status, next.debugId, next.ms);
  }

  // Orders, captures and transaction search, as the server SDK returned them.
  if (req.method === "GET") {
    const hit = tape.sdk[path.replace("&fields=all", "")];
    if (hit) {
      const session = await loadSession();
      return reply(shift(hit.response, session.delta), hit.status, hit.debugId, hit.ms);
    }
    // Transaction search was empty when recorded too (the sandbox lags by hours).
    if (path.startsWith("/v1/reporting/transactions")) return reply({ transactionDetails: [], totalItems: 0 }, 200, null, 300);
  }
  recordCall({ method: req.method, path, status: 422, debugId: null, ms: 5, via: "sdk", feature: req.feature, replay: true });
  throw notRecorded(`${req.method} ${path.split("?")[0]}`);
}

export async function replayAi(key: string, kind: AiTag["kind"]): Promise<{ text: string; ai: AiTag }> {
  const hit = tape.ai[key];
  if (!hit) throw new Error(`Replay has no recorded model output for ${key}.`);
  return { text: hit.text, ai: { model: hit.model, kind: hit.kind ?? kind, replay: true, ...(hit.fallback ? { fallback: true } : {}) } };
}
