/**
 * Model access: W&B Inference (OpenAI-compatible) through the Vercel AI SDK. Server-side only.
 *
 * - maxRetries 4 and a 60 s timeout on every call (the endpoint fails roughly 1 call in 20).
 * - After the primary model fails, one more attempt on the fallback model. The fallback always
 *   returns reasoning tokens first, so it gets a larger token budget and its content may be empty.
 * - In Replay mode the recorded output is returned and tagged as replayed.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, type CoreMessage, type LanguageModelV1 } from "ai";
import { env } from "@/lib/env";
import type { AiTag } from "@/lib/desk/types";
import { currentMode } from "@/lib/paypal/log";

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

const REASONING_HEADROOM = 1800;

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
    .replace(/\s*[—–]\s*/g, ", ")
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
    });
    const text = tidy(res.text ?? "");
    if (!text) throw new Error("The model returned no content.");
    return text;
  };

  try {
    // Both text models reason before they answer and the reasoning counts against max_tokens
    // (a 260 token budget came back empty with finish_reason "length"), so every call gets headroom.
    return { text: await attempt(primary, (opts.maxTokens ?? 700) + REASONING_HEADROOM), ai: { model: primary, kind: opts.kind } };
  } catch (first) {
    // The text fallback cannot read images, so a failed vision call is reported, not guessed.
    if (opts.vision) throw new AiUnavailableError(`Vision model failed: ${first instanceof Error ? first.message : first}`);
    try {
      const text = await attempt(env.aiFallbackModel, (opts.maxTokens ?? 700) + REASONING_HEADROOM);
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
