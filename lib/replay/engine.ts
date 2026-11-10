// Placeholder until the Replay engine lands (recorded sandbox and AI responses).
import type { PayPalRequest, PayPalResponse } from "@/lib/paypal/http";

export async function replayRequest<T>(req: PayPalRequest): Promise<PayPalResponse<T>> {
  throw new Error(`Replay fixture missing for ${req.method} ${req.path}`);
}
