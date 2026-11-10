/** Dev helper: see which request options change how many tokens the text models spend reasoning. */
import "../_env";

const BASE = process.env.OPENAI_BASE_URL!;
const KEY = process.env.OPENAI_API_KEY!;

const PROMPT =
  "Write the seller's response for a PayPal case on behalf of a plant shop. Goal: offer the buyer a partial refund of $24 to settle, politely, and say what the listing stated. " +
  "Facts: the product page has a size chart; packing photo on file; return policy on file; carrier scan shows delivered. " +
  "Rules: 90 to 150 words. Plain text. Only mention evidence marked present. End with 'Thank you, Juniper & Moss'.";

async function call(model: string, label: string, extra: Record<string, unknown>, content = PROMPT) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 3420, temperature: 0.2, ...extra }),
      signal: AbortSignal.timeout(120_000),
    });
    const json: any = await res.json();
    const msg = json.choices?.[0]?.message ?? {};
    const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
    console.log(
      `${model.split("/").pop()} | ${label} | http ${res.status} | ${Date.now() - t0} ms | finish ${json.choices?.[0]?.finish_reason} | completion ${json.usage?.completion_tokens} | content ${String(msg.content ?? "").length} chars | reasoning ${String(reasoning).length} chars${json.error ? ` | error ${JSON.stringify(json.error).slice(0, 200)}` : ""}`,
    );
  } catch (err) {
    console.log(`${model.split("/").pop()} | ${label} | FAILED after ${Date.now() - t0} ms: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  for (const model of [process.env.OPENAI_MODEL!, process.env.OPENAI_FALLBACK_MODEL!]) {
    await call(model, "baseline", {});
    await call(model, "enable_thinking false", { chat_template_kwargs: { enable_thinking: false } });
    await call(model, "reasoning_effort low", { reasoning_effort: "low" });
    await call(model, "/no_think", {}, `${PROMPT} /no_think`);
  }
}

main();
