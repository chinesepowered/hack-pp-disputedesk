/** Dev helper: check the three models answer (text, tool calling, vision). */
import "../_env";
import { readFileSync, existsSync } from "node:fs";
import { generateText, tool } from "ai";
import { z } from "zod";
import { generate, model } from "@/lib/ai/client";
import { env } from "@/lib/env";

async function main() {
  const t0 = Date.now();
  const a = await generate({ kind: "text", messages: [{ role: "user", content: "In one short sentence, say why tracking numbers help win 'item not received' disputes." }], maxTokens: 120 });
  console.log("TEXT", a.ai.model, Date.now() - t0, "ms:", a.text);

  const t1 = Date.now();
  const res = await generateText({
    model: model(env.aiModel),
    system: "You are a clerk. Use the tools to answer.",
    prompt: "What is the status of dispute PP-R-TEST-1? Then tell me in one sentence.",
    tools: { get_dispute: tool({ description: "Get a dispute by id", parameters: z.object({ dispute_id: z.string() }), execute: async ({ dispute_id }) => ({ dispute_id, status: "WAITING_FOR_SELLER_RESPONSE", amount: "184.00" }) }) },
    maxSteps: 3,
    maxRetries: 4,
    maxTokens: 300,
  });
  console.log("TOOLS", Date.now() - t1, "ms steps:", res.steps.length, "calls:", res.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)), "| text:", res.text.slice(0, 200));

  const photo = process.argv[2];
  if (photo && existsSync(photo)) {
    const t2 = Date.now();
    const v = await generate({
      kind: "vision",
      vision: true,
      messages: [{ role: "user", content: [{ type: "text", text: "Does this photo show a parcel left at a door? Answer with JSON: {\"verdict\":\"yes|no|unclear\",\"summary\":\"one sentence\"}" }, { type: "image", image: readFileSync(photo), mimeType: "image/jpeg" }] }],
      maxTokens: 200,
    });
    console.log("VISION", v.ai.model, Date.now() - t2, "ms:", v.text.slice(0, 300));
  }
  const t3 = Date.now();
  const f = await generateText({ model: model(env.aiFallbackModel), prompt: "Reply with the single word: ready", maxTokens: 1200, maxRetries: 2 });
  console.log("FALLBACK", Date.now() - t3, "ms text:", JSON.stringify(f.text.slice(0, 80)), "reasoning?", Boolean((f as any).reasoning), "finish:", f.finishReason);
}
main().catch((e) => { console.error("FAILED", e.message?.slice(0, 500)); process.exit(1); });
