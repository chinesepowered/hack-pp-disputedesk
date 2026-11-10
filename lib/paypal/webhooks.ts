/**
 * Webhooks: signature verification and registration (plain REST, same OAuth helper).
 * Docs: https://developer.paypal.com/api/rest/webhooks/
 */
import { paypalRequest } from "./http";

export const DISPUTE_EVENT_TYPES = [
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
] as const;

export type WebhookHeaders = {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
};

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    authAlgo: headers.get("paypal-auth-algo"),
    certUrl: headers.get("paypal-cert-url"),
    transmissionId: headers.get("paypal-transmission-id"),
    transmissionSig: headers.get("paypal-transmission-sig"),
    transmissionTime: headers.get("paypal-transmission-time"),
  };
}

/**
 * POST /v1/notifications/verify-webhook-signature.
 * The event is spliced into the request as the exact text PayPal sent: re-serializing it would
 * change the bytes the signature covers.
 */
export async function verifyWebhookSignature(h: WebhookHeaders, webhookId: string, rawBody: string): Promise<boolean> {
  if (!h.authAlgo || !h.certUrl || !h.transmissionId || !h.transmissionSig || !h.transmissionTime) return false;
  const envelope = JSON.stringify({
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
    webhook_event: "__RAW_EVENT__",
  }).replace('"__RAW_EVENT__"', () => rawBody); // a function, so "$" in the event is not treated as a pattern
  const res = await paypalRequest<{ verification_status?: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    feature: "Webhook: verify signature",
    rawJson: envelope,
  });
  return res.data?.verification_status === "SUCCESS";
}

export type Webhook = { id: string; url: string; event_types: { name: string }[] };

export async function listWebhooks(): Promise<Webhook[]> {
  const res = await paypalRequest<{ webhooks?: Webhook[] }>({ method: "GET", path: "/v1/notifications/webhooks", feature: "Webhook: list" });
  return res.data.webhooks ?? [];
}

export async function createWebhook(url: string): Promise<Webhook> {
  const res = await paypalRequest<Webhook>({
    method: "POST",
    path: "/v1/notifications/webhooks",
    json: { url, event_types: DISPUTE_EVENT_TYPES.map((name) => ({ name })) },
    feature: "Webhook: register",
  });
  return res.data;
}

export async function deleteWebhook(id: string): Promise<void> {
  await paypalRequest({ method: "DELETE", path: `/v1/notifications/webhooks/${encodeURIComponent(id)}`, feature: "Webhook: delete" });
}
