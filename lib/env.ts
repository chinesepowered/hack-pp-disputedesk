/**
 * Server-side environment access. Nothing here is imported by client components.
 * The desk is sandbox only: it refuses to start against any other PayPal environment.
 */

export const PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
export const PAYPAL_WEB_URL = "https://www.sandbox.paypal.com";

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function assertSandbox(): void {
  const mode = read("PAYPAL_ENVIRONMENT") || "sandbox";
  if (mode !== "sandbox") {
    throw new Error(
      `PAYPAL_ENVIRONMENT is "${mode}". Dispute Desk only runs against the PayPal sandbox.`,
    );
  }
}

export const env = {
  get paypalClientId() {
    return read("PAYPAL_CLIENT_ID");
  },
  get paypalClientSecret() {
    return read("PAYPAL_CLIENT_SECRET");
  },
  get paypalWebhookId() {
    return read("PAYPAL_WEBHOOK_ID");
  },
  get buyerEmail() {
    return read("PAYPAL_SANDBOX_BUYER_EMAIL");
  },
  get buyerPassword() {
    return read("PAYPAL_SANDBOX_BUYER_PASSWORD");
  },
  get aiBaseUrl() {
    return read("OPENAI_BASE_URL") || "https://api.inference.wandb.ai/v1";
  },
  get aiKey() {
    return read("OPENAI_API_KEY");
  },
  get aiModel() {
    return read("OPENAI_MODEL") || "Qwen/Qwen3.8-27B";
  },
  get aiVisionModel() {
    return read("OPENAI_VISION_MODEL") || "google/gemma-4-31B-it";
  },
  get aiFallbackModel() {
    return read("OPENAI_FALLBACK_MODEL") || "zai-org/GLM-5.3-Flash";
  },
  get adminToken() {
    return read("DEMO_ADMIN_TOKEN");
  },
  get blobToken() {
    return read("BLOB_READ_WRITE_TOKEN");
  },
  get hasPayPal() {
    return Boolean(read("PAYPAL_CLIENT_ID") && read("PAYPAL_CLIENT_SECRET"));
  },
  get hasAi() {
    return Boolean(read("OPENAI_API_KEY"));
  },
};
