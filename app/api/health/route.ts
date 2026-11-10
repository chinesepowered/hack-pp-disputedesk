import { route } from "@/lib/api/route";
import { env } from "@/lib/env";
import { storeStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

/** What is configured, without revealing any value. */
export const GET = route("Health", async (_req, ctx) => ({
  ok: true,
  paypal: { configured: env.hasPayPal, environment: "sandbox", webhookId: Boolean(env.paypalWebhookId) },
  ai: { configured: env.hasAi, model: env.aiModel, visionModel: env.aiVisionModel, fallbackModel: env.aiFallbackModel },
  store: storeStatus(),
  adminReset: Boolean(env.adminToken),
  mode: ctx.mode,
}));
