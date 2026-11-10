import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { PayPalError } from "@/lib/paypal/http";
import { addOrderTracking, captureStoreOrder, getOrder } from "@/lib/paypal/sdk";
import { CARRIERS } from "@/lib/shop/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Demo store checkout, step 2: capture the approved order, then add tracking the way the shop
 * would at fulfillment (POST /v2/checkout/orders/{id}/track).
 */
export const POST = route("Demo store: capture order", async (_req, ctx) => {
  const orderId = ctx.params.id;
  if (!/^[A-Z0-9]{10,24}$/.test(orderId)) throw new DeskError(422, "BAD_ORDER", "That is not a PayPal order id.");

  let captureId: string | null = null;
  let status: string | undefined;
  try {
    // The order id is the idempotency key: a double click captures once.
    const res = await captureStoreOrder(orderId, { requestId: `store-capture-${orderId}`, feature: "Demo store: capture order" });
    captureId = res.captureId;
    status = res.status;
  } catch (err) {
    if (err instanceof PayPalError && err.unknownOutcome) {
      // No answer from PayPal: read the order back before saying anything about the payment.
      const { order } = await getOrder(orderId, "Demo store: re-read order after no response");
      captureId = order.purchaseUnits?.[0]?.payments?.captures?.[0]?.id ?? null;
      status = order.status;
      if (!captureId) throw new DeskError(502, "CAPTURE_UNKNOWN", "PayPal did not answer and the order shows no capture yet. Check again before retrying.");
    } else throw err;
  }
  if (!captureId) throw new DeskError(409, "NOT_CAPTURED", `The order was not captured (status ${status ?? "unknown"}).`);

  const trackingNumber = `${CARRIERS.harbor.prefix}${orderId.slice(-8)}US`;
  let tracked = true;
  try {
    await addOrderTracking(orderId, { captureId, trackingNumber, carrierNameOther: CARRIERS.harbor.name }, "Demo store: add tracking");
  } catch {
    tracked = false;
  }
  return { orderId, captureId, status, trackingNumber: tracked ? trackingNumber : null, carrier: CARRIERS.harbor.name };
});
