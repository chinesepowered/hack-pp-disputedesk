/** Dev helper: run the real draft task for a stored case and print the result or the error. */
import "../_env";
import { readFileSync } from "node:fs";
import { draftResponse } from "@/lib/ai/tasks";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: tsx scripts/dev/draft-probe.ts <dispute-id>");
  const detail = JSON.parse(readFileSync(`.data/case-${id}.json`, "utf8"));
  const t0 = Date.now();
  try {
    const res = await draftResponse(detail.dispute, detail.evidence, detail.checklist, detail.recommendation);
    console.log(`${Date.now() - t0} ms`, res.ai, `${res.text.split(/\s+/).length} words`);
    console.log(res.text);
  } catch (err) {
    console.log(`${Date.now() - t0} ms FAILED:`, err instanceof Error ? `${err.name}: ${err.message.slice(0, 600)}` : err);
  }
}

main();
