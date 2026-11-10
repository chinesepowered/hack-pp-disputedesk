/**
 * Model access: W&B Inference (OpenAI-compatible) through the Vercel AI SDK. Server-side only.
 *
 * - maxRetries 4 and a 60 s timeout on every call (the endpoint fails roughly 1 call in 20).
 * - After the primary model fails, one more attempt on the fallback model.
 * - The text models reason before they answer; the writing tasks switch that off (see
 *   directAnswerOptions) and every call still gets token headroom in case a model ignores it.
 * - In Replay mode the recorded output is returned and tagged as replayed.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type CoreMessage, type LanguageModelV1 } from "ai";
import { env } from "@/lib/env";
import type { AiTag } from "@/lib/desk/types";
import { currentMode } from "@/lib/paypal/log";
import { record } from "@/lib/replay/recorder";

let provider: ReturnType<typeof createOpenAICompatible> | null = null;

function wandb() {
  if (!provider) {
    provider = createOpenAICompatible({
      name: "wandb-inference",
      baseURL: env.aiBaseUrl,
      apiKey: env.aiKey,
    });
  }
  return provider;
}

export function model(id: string): LanguageModelV1 {
  return wandb().chatModel(id);
}

const REASONING_HEADROOM = 3000;

/**
 * Request fields that stop a model reasoning before it answers. Both text models spend
 * completion tokens on hidden reasoning, and on some prompts they spent the whole budget and
 * returned nothing. Measured on W&B Inference with scripts/dev/reasoning-probe.ts: Qwen answers
 * directly with the chat template switch, GLM with low reasoning effort. The writing tasks use
 * this (the facts and the decision are already fixed by the rules); the tool-calling agent in
 * lib/agent/run.ts keeps its reasoning.
 */
export function directAnswerOptions(id: string): Record<string, unknown> {
  if (/qwen/i.test(id)) return { chat_template_kwargs: { enable_thinking: false } };
  if (/glm/i.test(id)) return { reasoningEffort: "low" };
  return {};
}

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export type AiTextResult = { text: string; ai: AiTag };

/** Models that think out loud wrap it in tags or leave it inline: keep only the answer. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

/** No em dashes anywhere in this product, including model output. */
export function tidy(text: string): string {
  return stripReasoning(text)
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\*\*/g, "")
    .trim();
}

export async function generate(opts: {
  kind: AiTag["kind"];
  system?: string;
  messages: CoreMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Key under which Replay mode finds the recorded output. */
  replayKey?: string;
  vision?: boolean;
}): Promise<AiTextResult> {
  if (currentMode() === "replay") {
    const { replayAi } = await import("@/lib/replay/engine");
    return replayAi(opts.replayKey ?? "unknown", opts.kind);
  }
  if (!env.hasAi) throw new AiUnavailableError("OPENAI_API_KEY is not set.");

  const primary = opts.vision ? env.aiVisionModel : env.aiModel;
  const attempt = async (id: string, maxTokens: number) => {
    const res = await generateText({
      model: model(id),
      system: opts.system,
      messages: opts.messages,
      maxTokens,
      temperature: opts.temperature ?? 0.2,
      maxRetries: 4,
      abortSignal: AbortSignal.timeout(60_000),
      ...(opts.vision ? {} : { providerOptions: { "wandb-inference": directAnswerOptions(id) as Record<string, never> } }),
    });
    const text = tidy(res.text ?? "");
    if (!text) throw new Error(`The model returned no content (finish ${res.finishReason}, ${res.usage?.completionTokens ?? "?"} completion tokens, ${(res.text ?? "").length} raw characters).`);
    return text;
  };

  const keep = (text: string, id: string, fallback: boolean) => {
    if (opts.replayKey) record({ kind: "ai", key: opts.replayKey, aiKind: opts.kind, model: id, text, ...(fallback ? { fallback: true } : {}) });
    return text;
  };

  try {
    // Both text models reason before they answer and the reasoning counts against max_tokens
    // (a 260 token budget came back empty with finish_reason "length"), so every call gets headroom.
    return { text: keep(await attempt(primary, (opts.maxTokens ?? 700) + REASONING_HEADROOM), primary, false), ai: { model: primary, kind: opts.kind } };
  } catch (first) {
    // The text fallback cannot read images, so a failed vision call is reported, not guessed.
    if (opts.vision) throw new AiUnavailableError(`Vision model failed: ${first instanceof Error ? first.message : first}`);
    try {
      const text = keep(await attempt(env.aiFallbackModel, (opts.maxTokens ?? 700) + REASONING_HEADROOM), env.aiFallbackModel, true);
      return { text, ai: { model: env.aiFallbackModel, kind: opts.kind, fallback: true } };
    } catch (second) {
      throw new AiUnavailableError(
        `Both models failed. ${first instanceof Error ? first.message : first} / ${second instanceof Error ? second.message : second}`,
      );
    }
  }
}

/** Pull the first JSON object out of a model reply. */
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
