/** Dev helper: print a dispute's state and links, or run one action. Not part of the app. */
import "../_env";
import { getDispute, listDisputes, escalateDispute, requireEvidence, adjudicate, sendMessage } from "@/lib/paypal/disputes";
import { looseCalls } from "@/lib/paypal/log";

function redact(o: any): any {
  if (Array.isArray(o)) return o.map(redact);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /email/i.test(k) ? "[redacted]" : redact(v)]));
  return o;
}

async function main() {
  const [cmd, id, arg] = process.argv.slice(2);
  try {
    if (cmd === "list") {
      const items = await listDisputes();
      for (const d of items) console.log(d.dispute_id, d.reason, d.status, d.dispute_state, d.dispute_life_cycle_stage, d.dispute_amount?.value, d.seller_response_due_date ?? "-", d.update_time);
      console.log(`${items.length} disputes`);
    } else if (cmd === "get") {
      const d = await getDispute(id);
      if (arg === "full") console.log(JSON.stringify(redact(d), null, 1));
      else console.log({ id: d.dispute_id, reason: d.reason, status: d.status, state: d.dispute_state, stage: d.dispute_life_cycle_stage, due: d.seller_response_due_date, buyerDue: d.buyer_response_due_date, outcome: d.dispute_outcome, allowed: d.allowed_response_options, links: d.links?.map((l) => l.rel), evidences: d.evidences?.map((e) => `${e.evidence_type}/${e.source}`), offer: d.offer });
    } else if (cmd === "escalate") console.log((await escalateDispute(id, arg ?? "Escalating to a claim.")).data);
    else if (cmd === "require") console.log((await requireEvidence(id, (arg as any) ?? "SELLER_EVIDENCE")).data);
    else if (cmd === "adjudicate") console.log((await adjudicate(id, (arg as any) ?? "SELLER_FAVOR")).data);
    else if (cmd === "message") console.log((await sendMessage(id, arg ?? "Hello from the seller.")).data);
    else console.log("usage: list | get <id> [full] | escalate <id> | require <id> | adjudicate <id> | message <id>");
  } catch (e: any) {
    console.log("ERROR", e.status, e.code, e.message, e.debugId);
  }
  for (const c of looseCalls()) console.log(`  ${c.method} ${c.path} -> ${c.status} [${c.debugId}] ${c.ms}ms`);
}
main();
