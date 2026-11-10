import { NextResponse, type NextRequest } from "next/server";
import { refreshCase } from "@/lib/desk/sync";
import { env } from "@/lib/env";
import { runWithRecorder } from "@/lib/paypal/log";
import { DISPUTE_EVENT_TYPES, readWebhookHeaders, verifyWebhookSignature } from "@/lib/paypal/webhooks";
import { getDoc, setDoc } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SeenEvents = { ids: string[] };

/**
 * PayPal webhook: CUSTOMER.DISPUTE.CREATED, UPDATED and RESOLVED.
 *
 * - The signature is verified with POST /v1/notifications/verify-webhook-signature against the
 *   raw body before anything is trusted.
 * - Handlers are idempotent: each event id is processed once.
 * - The event is only a hint. The handler re-reads the dispute from PayPal, and every screen
 *   polls as well, so nothing depends on delivery.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const webhookId = env.paypalWebhookId;
  if (!webhookId) {
    return NextResponse.json({ error: "PAYPAL_WEBHOOK_ID is not set. Run pnpm paypal:webhook <public-url> and set it." }, { status: 503 });
  }

  const { result } = await runWithRecorder({ feature: "Webhook: dispute event", mode: "live", sessionId: "webhook" }, async () => {
    let verified = false;
    try {
      verified = await verifyWebhookSignature(readWebhookHeaders(req.headers), webhookId, raw);
    } catch {
      verified = false;
    }
    if (!verified) return { status: 400, body: { error: "Signature verification failed." } };

    let event: { id?: string; event_type?: string; resource?: { dispute_id?: string } };
    try {
      event = JSON.parse(raw);
    } catch {
      return { status: 400, body: { error: "Body is not JSON." } };
    }
    if (!event.id || !event.event_type) return { status: 400, body: { error: "Not a PayPal event." } };
    if (!(DISPUTE_EVENT_TYPES as readonly string[]).includes(event.event_type)) {
      return { status: 200, body: { ignored: event.event_type } };
    }

    const seen = (await getDoc<SeenEvents>("webhook-events")) ?? { ids: [] };
    if (seen.ids.includes(event.id)) return { status: 200, body: { duplicate: true } };

    const disputeId = event.resource?.dispute_id;
    if (disputeId) {
      try {
        await refreshCase(disputeId, `Webhook: ${event.event_type}`);
      } catch {
        // PayPal retries on a non-200. The next poll will pick the dispute up either way.
        return { status: 500, body: { error: "Could not refresh the dispute." } };
      }
    }
    seen.ids = [...seen.ids.slice(-499), event.id];
    await setDoc("webhook-events", seen);
    return { status: 200, body: { ok: true, event: event.event_type, disputeId } };
  });

  return NextResponse.json(result.body, { status: result.status });
}
