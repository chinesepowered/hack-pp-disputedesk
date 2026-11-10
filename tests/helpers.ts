import { storeRecords } from "@/lib/desk/evidence";
import { DEFAULT_SETTINGS, type EvidenceBundle, type PhotoRead, type Settings } from "@/lib/desk/types";
import type { Dispute, DisputeReason } from "@/lib/paypal/types";
import { CARRIERS, productBySku } from "@/lib/shop/catalog";
import { scenarioByKey } from "@/lib/shop/scenarios";

export const settings: Settings = { ...DEFAULT_SETTINGS };

const REASON: Record<string, DisputeReason> = {
  not_received: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  not_as_described: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  unauthorized: "UNAUTHORISED",
};

export function dispute(key: string, opts: { links?: string[]; stage?: Dispute["dispute_life_cycle_stage"]; status?: Dispute["status"]; allowedRefund?: string } = {}): Dispute {
  const s = scenarioByKey(key)!;
  const product = productBySku(s.sku)!;
  return {
    dispute_id: `PP-R-TST-${key.length}`,
    create_time: "2026-11-10T15:00:00.000Z",
    update_time: "2026-11-10T15:05:00.000Z",
    reason: REASON[s.dispute?.reason ?? "not_received"],
    status: opts.status ?? "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: { currency_code: "USD", value: product.price },
    dispute_life_cycle_stage: opts.stage ?? "INQUIRY",
    refund_details: { allowed_refund_amount: { currency_code: "USD", value: opts.allowedRefund ?? product.price } },
    allowed_response_options: { make_offer: { offer_types: ["REFUND", "REFUND_WITH_RETURN"] }, accept_claim: { accept_claim_types: ["REFUND"] } },
    evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" }],
    links: ["self", ...(opts.links ?? ["accept_claim", "provide_evidence", "send_message", "escalate", "make_offer"])].map((rel) => ({ rel, href: "https://example.test", method: "GET" })),
  };
}

/** The evidence bundle the desk would gather for a seed scenario, without calling PayPal. */
export function bundle(key: string, reads: Partial<Record<"delivery" | "damage", "yes" | "no" | "unclear">> = {}): EvidenceBundle {
  const s = scenarioByKey(key)!;
  const product = productBySku(s.sku)!;
  const tracking = s.shipping.addToPayPal && s.shipping.carrier ? `${CARRIERS[s.shipping.carrier].prefix}0001US` : null;
  const store = storeRecords(s, "2026-11-10T15:00:00.000Z", tracking);
  const photoReads: PhotoRead[] = [];
  const ai = { model: "test", kind: "vision" as const };
  if (store.carrier?.photo && reads.delivery) photoReads.push({ photo: store.carrier.photo, question: "delivery", verdict: reads.delivery, summary: "read", ai });
  if (store.buyerPhoto && reads.damage) photoReads.push({ photo: store.buyerPhoto, question: "damage", verdict: reads.damage, summary: "read", ai });
  return {
    gatheredAt: "2026-11-10T15:10:00.000Z",
    scenarioKey: key,
    paypal: {
      captureId: "CAP1",
      orderId: "ORD1",
      invoiceId: "JM-1",
      captureStatus: "PENDING",
      capturedAt: "2026-11-10T15:00:00.000Z",
      amount: product.price,
      sellerProtection: "ELIGIBLE",
      sellerProtectionCategories: ["ITEM_NOT_RECEIVED"],
      items: [{ name: product.name, sku: product.sku, quantity: "1", unitAmount: product.price }],
      shipTo: { name: s.shipTo.fullName, line1: s.shipTo.addressLine1, city: s.shipTo.city, state: s.shipTo.state, postalCode: s.shipTo.postalCode, country: "US" },
      trackers: tracking ? [{ id: `CAP1-${tracking}`, number: tracking, carrier: store.carrier?.name ?? "Carrier", status: "SHIPPED" }] : [],
      transactionSearch: "not_indexed_yet",
      payerName: "Test Buyer",
    },
    store,
    photoReads,
  };
}
