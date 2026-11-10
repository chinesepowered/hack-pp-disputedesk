/** Dev helper: log status, stage and links for disputes every minute, to learn sandbox timing. */
import "../_env";
import { appendFileSync } from "node:fs";
import { getDispute } from "@/lib/paypal/disputes";

const ids = process.argv.slice(3);
const out = process.argv[2];
const last = new Map<string, string>();
async function tick() {
  for (const id of ids) {
    try {
      const d = await getDispute(id);
      const line = `${d.status} | ${d.dispute_state} | ${d.dispute_life_cycle_stage} | due=${d.seller_response_due_date ?? "-"} | links=${(d.links ?? []).map((l) => l.rel).join(",")} | outcome=${d.dispute_outcome?.outcome_code ?? "-"} | requested=${(d.evidences ?? []).filter((e) => e.source === "REQUESTED_FROM_SELLER").map((e) => e.evidence_type).join(",")}`;
      if (last.get(id) !== line) {
        last.set(id, line);
        appendFileSync(out, `${new Date().toISOString().slice(11, 19)} ${id} ${line}\n`);
      }
    } catch (e: any) {
      appendFileSync(out, `${new Date().toISOString().slice(11, 19)} ${id} ERROR ${e.message}\n`);
    }
  }
}
(async () => {
  for (let i = 0; i < 40; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, 45_000));
  }
})();
