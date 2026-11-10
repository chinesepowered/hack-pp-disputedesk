// Placeholder until the Replay engine lands (recorded sandbox and AI responses).
import type { PayPalRequest, PayPalResponse } from "@/lib/paypal/http";

export async function replayRequest<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
  throw new Error(`Replay fixture missing for ${req.method} ${req.path}`);
}

export async function replayAi(key: string, kind: "vision" | "text" | "agent"): Promise<{ text: string; ai: { model: string; kind: "vision" | "text" | "agent"; replay: true } }> {
  throw new Error(`Replay fixture missing for AI output ${key} (${kind})`);
}
