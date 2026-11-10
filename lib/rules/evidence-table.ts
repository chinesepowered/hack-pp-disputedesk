/**
 * Reason to required evidence. Deterministic and in the repo on purpose: this table, not the
 * model, decides what counts as evidence, what is missing and how much each item is worth.
 *
 * Where it comes from (each source was read while building; see the README for dates):
 * - PayPal's "Use Disputes API" guide: which actions exist at each stage and status, and that
 *   "PayPal requests specific evidence based on the dispute reason", read from `reason`,
 *   `evidences.evidence_type` and `evidences.source`. Proof of fulfillment carries tracking
 *   information; proof of refund carries a refund id.
 *   https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api
 * - PayPal's disputes overview: 180 days to dispute, up to 20 days to resolve an inquiry,
 *   PayPal decides a claim within 10 days on the evidence from both parties.
 *   https://developer.paypal.com/disputes/overview
 * - The Disputes API v1 OpenAPI document (`evidence_type` values such as PROOF_OF_FULFILLMENT,
 *   PROOF_OF_DELIVERY_SIGNATURE and OTHER; `evidences[].source: REQUESTED_FROM_SELLER`).
 *   https://github.com/paypal/paypal-rest-api-specifications (openapi/customer_disputes_v1.json)
 * - What the sandbox itself asked for: on "not received" disputes it requested
 *   PROOF_OF_FULFILLMENT at the inquiry stage and PROOF_OF_FULFILLMENT, PROOF_OF_REFUND and
 *   OTHER at the claim stage; captures report seller protection for the categories
 *   ITEM_NOT_RECEIVED and UNAUTHORIZED_TRANSACTION (docs/build-log.md).
 *
 * PayPal's Seller Protection policy page could not be fetched from the build environment, so
 * nothing here quotes it. The `points` are this desk's own transparent scoring, not a PayPal
 * number. They add up to the "win estimate" shown in the UI, which is always labeled as an
 * estimate.
 */
import type { DisputeReason } from "@/lib/paypal/types";

export type RequirementKey =
  | "tracking_on_paypal"
  | "carrier_delivered"
  | "address_match"
  | "delivery_photo"
  | "signature"
  | "customer_thread"
  | "billing_match"
  | "ip_match"
  | "repeat_customer"
  | "listing_specific"
  | "packing_photo"
  | "return_policy"
  | "seller_replied"
  | "buyer_photo";

export type Requirement = {
  key: RequirementKey;
  label: string;
  /** Why PayPal (or common sense) cares, shown as help text. */
  why: string;
  required: boolean;
  points: number;
  /** Points taken off when the evidence actively hurts the case (for example a photo of damage). */
  againstPoints?: number;
  evidenceType: string;
  source: "PayPal" | "Store records" | "AI read";
};

export type ReasonRule = {
  reason: DisputeReason;
  title: string;
  base: number;
  /** PayPal evidence types this desk can file for the reason, best first. */
  fileAs: string[];
  requirements: Requirement[];
  /** Offers (partial refunds, returns) only make sense for these reasons. */
  offerable: boolean;
};

const NOT_RECEIVED: ReasonRule = {
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  title: "Item not received",
  base: 5,
  fileAs: ["PROOF_OF_FULFILLMENT", "PROOF_OF_DELIVERY_SIGNATURE", "OTHER"],
  offerable: true,
  requirements: [
    { key: "tracking_on_paypal", label: "Tracking number on the PayPal order", why: "PayPal checks the tracking it already holds for the transaction first.", required: true, points: 20, evidenceType: "PROOF_OF_FULFILLMENT", source: "PayPal" },
    { key: "carrier_delivered", label: "Carrier scan shows delivered", why: "Proof of delivery, not just proof of shipment, decides most of these claims.", required: true, points: 25, evidenceType: "PROOF_OF_FULFILLMENT", source: "Store records" },
    { key: "address_match", label: "Delivered to the address on the PayPal order", why: "Shows the parcel went to the address the buyer gave PayPal for this order.", required: true, points: 15, evidenceType: "PROOF_OF_FULFILLMENT", source: "PayPal" },
    { key: "delivery_photo", label: "Delivery photo shows the parcel at a door", why: "A carrier photo answers 'it says delivered but it is not here'.", required: false, points: 10, againstPoints: 15, evidenceType: "PROOF_OF_FULFILLMENT", source: "AI read" },
    { key: "signature", label: "Signature on delivery", why: "A signed delivery is the strongest proof for higher value orders.", required: false, points: 15, evidenceType: "PROOF_OF_DELIVERY_SIGNATURE", source: "Store records" },
    { key: "customer_thread", label: "Messages with the customer", why: "Shows you answered and shared tracking before the claim.", required: false, points: 5, evidenceType: "OTHER", source: "Store records" },
  ],
};

const UNAUTHORISED: ReasonRule = {
  reason: "UNAUTHORISED",
  title: "Unauthorized payment",
  base: 5,
  fileAs: ["PROOF_OF_FULFILLMENT", "PROOF_OF_DELIVERY_SIGNATURE", "OTHER"],
  offerable: false,
  requirements: [
    { key: "tracking_on_paypal", label: "Tracking number on the PayPal order", why: "PayPal asks for proof of fulfillment, and that starts with a tracking number.", required: true, points: 15, evidenceType: "PROOF_OF_FULFILLMENT", source: "PayPal" },
    { key: "carrier_delivered", label: "Carrier scan shows delivered", why: "Shows the goods reached the address the buyer gave PayPal.", required: true, points: 20, evidenceType: "PROOF_OF_FULFILLMENT", source: "Store records" },
    { key: "address_match", label: "Delivered to the address on the PayPal order", why: "Shows the goods went to the address on the PayPal order, not somewhere else.", required: true, points: 10, evidenceType: "PROOF_OF_FULFILLMENT", source: "PayPal" },
    { key: "billing_match", label: "Billing and shipping details match", why: "A mismatch is the most common sign of a stolen account.", required: false, points: 15, againstPoints: 20, evidenceType: "OTHER", source: "Store records" },
    { key: "ip_match", label: "Ordered from the customer's usual region", why: "Supports that the account holder placed the order.", required: false, points: 10, evidenceType: "OTHER", source: "Store records" },
    { key: "repeat_customer", label: "Customer has ordered before", why: "Earlier undisputed orders to the same address make fraud unlikely.", required: false, points: 10, evidenceType: "OTHER", source: "Store records" },
    { key: "signature", label: "Signature on delivery", why: "Ties the delivery to a named person at the address.", required: false, points: 10, evidenceType: "PROOF_OF_DELIVERY_SIGNATURE", source: "Store records" },
  ],
};

const NOT_AS_DESCRIBED: ReasonRule = {
  reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  title: "Not as described",
  base: 15,
  fileAs: ["PROOF_OF_FULFILLMENT", "OTHER"],
  offerable: true,
  requirements: [
    { key: "listing_specific", label: "Product page states the detail in dispute", why: "A size chart or measurement on the listing shows the item matched what was sold.", required: true, points: 25, evidenceType: "OTHER", source: "Store records" },
    { key: "packing_photo", label: "Photo of the item as packed", why: "Shows what left the building and its condition.", required: true, points: 15, evidenceType: "OTHER", source: "Store records" },
    { key: "return_policy", label: "Return policy on file", why: "PayPal asks whether the buyer was offered a return.", required: true, points: 10, evidenceType: "OTHER", source: "Store records" },
    { key: "seller_replied", label: "You replied and offered a fix", why: "Shows good faith before the claim was opened.", required: false, points: 10, evidenceType: "OTHER", source: "Store records" },
    { key: "carrier_delivered", label: "Carrier scan shows delivered", why: "Confirms the timeline of delivery and complaint.", required: false, points: 10, evidenceType: "PROOF_OF_FULFILLMENT", source: "Store records" },
    { key: "buyer_photo", label: "Buyer's photo does not show damage", why: "A photo of real damage usually settles the claim for the buyer.", required: false, points: 0, againstPoints: 25, evidenceType: "OTHER", source: "AI read" },
  ],
};

const FALLBACK: ReasonRule = {
  reason: "OTHER",
  title: "Other",
  base: 20,
  fileAs: ["OTHER"],
  offerable: true,
  requirements: [
    { key: "tracking_on_paypal", label: "Tracking number on the PayPal order", why: "Shows the order was fulfilled.", required: true, points: 20, evidenceType: "PROOF_OF_FULFILLMENT", source: "PayPal" },
    { key: "customer_thread", label: "Messages with the customer", why: "Shows what was agreed.", required: true, points: 15, evidenceType: "OTHER", source: "Store records" },
    { key: "return_policy", label: "Return policy on file", why: "Shows the terms the buyer accepted.", required: false, points: 10, evidenceType: "OTHER", source: "Store records" },
  ],
};

export const EVIDENCE_TABLE: ReasonRule[] = [NOT_RECEIVED, UNAUTHORISED, NOT_AS_DESCRIBED, FALLBACK];

export function ruleFor(reason: string): ReasonRule {
  return EVIDENCE_TABLE.find((r) => r.reason === reason) ?? FALLBACK;
}

export function reasonTitle(reason: string): string {
  return ruleFor(reason).reason === reason ? ruleFor(reason).title : reason.replace(/_/g, " ").toLowerCase();
}
