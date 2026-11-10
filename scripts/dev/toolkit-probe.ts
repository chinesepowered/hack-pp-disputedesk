/** Dev helper: call the Agent Toolkit's get_dispute directly and show what the call log caught. */
import "../_env";
import { buildTools } from "@/lib/agent/tools";
import { runWithRecorder } from "@/lib/paypal/log";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: tsx scripts/dev/toolkit-probe.ts <dispute-id>");
  const events: any[] = [];
  const { result, calls } = await runWithRecorder({ feature: "probe", mode: "live", sessionId: "probe" }, async () => {
    const tools = buildTools({ model: "probe", kind: "agent" }, events);
    return (tools.get_dispute as any).execute({ dispute_id: id }, { toolCallId: "probe", messages: [] });
  });
  console.log("output:", String(result).slice(0, 300));
  console.log("events:", events);
  console.log("calls:", calls.map((c: any) => `${c.method} ${c.path} ${c.status} via ${c.via} (${c.feature ?? "no feature"}) debug ${c.debugId}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
