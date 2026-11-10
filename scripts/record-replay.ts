/**
 * pnpm replay:record <dispute-id>[=label] ...
 *
 * Builds fixtures/replay/tape.json from .data/recordings/tape.jsonl, the log of real PayPal
 * sandbox responses and model outputs written while DISPUTEDESK_RECORD=1 is set.
 *
 * For each dispute id given, the recording is reduced to a tape: each distinct state PayPal
 * returned, and each POST the desk made with PayPal's answer, in the order they happened.
 * Email addresses are replaced before anything is written to the repo.
 *
 *   pnpm replay:record --list                      disputes found in the recording
 *   pnpm replay:record PP-R-ABC-123="Hero case" PP-R-DEF-456
 */
import "./_env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Entry = {
  t: string;
  kind: "rest" | "sdk" | "ai";
  method?: string;
  path?: string;
  status?: number;
  debugId?: string | null;
  ms?: number;
  response?: any;
  request?: any;
  key?: string;
  aiKind?: string;
  model?: string;
  text?: string;
  fallback?: boolean;
};

const TAPE = path.join(process.cwd(), ".data", "recordings", "tape.jsonl");
const OUT = path.join(process.cwd(), "fixtures", "replay", "tape.json");
const DISPUTE = /^\/v1\/customer\/disputes\/([^/?]+)(?:\/([a-z-]+))?/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redact(value: any): any {
  if (typeof value === "string") return value.replace(EMAIL, (m) => (m.includes("business") ? "seller@juniperandmoss.example" : "buyer@example.com"));
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
}

/** What makes two reads of a dispute "the same state". */
function signature(d: any): string {
  return JSON.stringify([
    d.status,
    d.dispute_state,
    d.dispute_life_cycle_stage,
    d.seller_response_due_date ?? null,
    (d.links ?? []).map((l: any) => l.rel).sort(),
    d.dispute_outcome?.outcome_code ?? null,
    (d.evidences ?? []).length,
    (d.supporting_info ?? []).length,
    (d.messages ?? []).length,
    d.offer?.seller_offered_amount?.value ?? null,
    (d.fund_movements ?? []).length,
  ]);
}

function main() {
  if (!existsSync(TAPE)) {
    console.error("No recording found. Set DISPUTEDESK_RECORD=1 in .env.local, run the app against the sandbox, then run this again.");
    process.exit(1);
  }
  const entries: Entry[] = readFileSync(TAPE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const args = process.argv.slice(2);

  const seen = new Map<string, { reads: number; posts: string[]; reason?: string; amount?: string; status?: string }>();
  for (const e of entries) {
    const m = e.kind === "rest" ? e.path?.match(DISPUTE) : null;
    if (!m) continue;
    const info = seen.get(m[1]) ?? { reads: 0, posts: [] };
    if (e.method === "GET" && e.status === 200) {
      info.reads++;
      info.reason = e.response?.reason;
      info.amount = e.response?.dispute_amount?.value;
      info.status = e.response?.status;
    } else if (e.method === "POST" && e.status && e.status < 300 && m[2]) info.posts.push(m[2]);
    seen.set(m[1], info);
  }
  if (args.includes("--list") || !args.length) {
    for (const [id, i] of seen) console.log(`${id}  $${i.amount ?? "?"}  ${i.reason ?? ""}  now ${i.status ?? "?"}  reads ${i.reads}  posts [${i.posts.join(", ")}]`);
    if (!args.length) console.log("\nUsage: pnpm replay:record <dispute-id>[=label] ...");
    return;
  }

  const picks = args
    .filter((a) => !a.startsWith("--"))
    .map((a) => {
      const [id, label] = a.split("=");
      return { id, label };
    });
  const out: any = {
    recordedAt: entries.at(-1)?.t ?? null,
    note: "Built by pnpm replay:record from real PayPal sandbox and model responses. Do not edit by hand.",
    disputes: {},
    sdk: {},
    ai: {},
  };

  for (const pick of picks) {
    const tape: any[] = [];
    let lastSig = "";
    let last: any = null;
    for (const e of entries) {
      const m = e.kind === "rest" ? e.path?.match(DISPUTE) : null;
      if (!m || m[1] !== pick.id) continue;
      if (e.method === "GET" && e.status === 200 && e.response?.dispute_id) {
        const sig = signature(e.response);
        if (sig === lastSig) continue;
        lastSig = sig;
        last = e.response;
        tape.push({ type: "state", dispute: redact(e.response), debugId: e.debugId ?? null, ms: e.ms ?? 600 });
      } else if (e.method === "POST" && e.status && e.status < 300 && m[2] && tape.length) {
        tape.push({
          type: "post",
          action: m[2].replace(/-/g, "_"),
          ...(e.request?.adjudication_outcome ? { outcome: e.request.adjudication_outcome } : {}),
          status: e.status,
          response: redact(e.response),
          debugId: e.debugId ?? null,
          ms: e.ms ?? 1500,
        });
        lastSig = "";
      }
    }
    if (!tape.length || !last) {
      console.log(`${pick.id}: nothing recorded, skipped`);
      continue;
    }
    const captureId: string | undefined = last.disputed_transactions?.[0]?.seller_transaction_id;
    const label = pick.label ?? `${String(last.reason ?? "").replace(/_/g, " ").toLowerCase()}, $${last.dispute_amount?.value}`;
    out.disputes[pick.id] = { label, tape };
    const posts = tape.filter((i) => i.type === "post").map((i) => i.action);
    console.log(`${pick.id}: ${tape.length - posts.length} states, posts [${posts.join(", ")}]  (${label})`);

    // The case file's own reads: capture, order, transaction search.
    let orderId: string | undefined;
    for (const e of entries) {
      if (e.kind !== "sdk" || e.method !== "GET" || !e.path || e.status !== 200) continue;
      if (captureId && e.path === `/v2/payments/captures/${captureId}`) {
        out.sdk[e.path] = { status: 200, debugId: e.debugId ?? null, ms: e.ms ?? 500, response: redact(e.response) };
        orderId = e.response?.supplementaryData?.relatedIds?.orderId ?? orderId;
      }
    }
    for (const e of entries) {
      if (e.kind !== "sdk" || e.method !== "GET" || !e.path || e.status !== 200) continue;
      if (orderId && e.path === `/v2/checkout/orders/${orderId}`) {
        out.sdk[e.path] = { status: 200, debugId: e.debugId ?? null, ms: e.ms ?? 500, response: redact(e.response) };
      }
      if (captureId && e.path.startsWith(`/v1/reporting/transactions?transaction_id=${captureId}`)) {
        out.sdk[e.path.replace("&fields=all", "")] = { status: 200, debugId: e.debugId ?? null, ms: e.ms ?? 500, response: redact(e.response) };
      }
    }
    if (captureId && !out.sdk[`/v2/payments/captures/${captureId}`]) {
      console.log(`  warning: no capture read recorded for ${pick.id}. Open its case file once with recording on.`);
    }
  }

  // Model outputs: the latest recording for each key that belongs to a picked dispute or is shared.
  const ids = new Set(picks.map((p) => p.id));
  for (const e of entries) {
    if (e.kind !== "ai" || !e.key || !e.text) continue;
    const scoped = e.key.match(/^(explain|draft|agent):(.+)$/);
    if (scoped && !ids.has(scoped[2])) continue;
    out.ai[e.key] = { model: e.model, text: e.text, kind: e.aiKind, ...(e.fallback ? { fallback: true } : {}) };
  }
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(out.disputes).length} disputes, ${Object.keys(out.sdk).length} SDK reads, ${Object.keys(out.ai).length} model outputs.`);
}

main();
