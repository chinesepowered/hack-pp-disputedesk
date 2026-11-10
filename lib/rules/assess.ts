/**
 * The deterministic core: checklist, readiness, win estimate, recommendation and economics.
 * No model output is used here. The AI only reads photos (reported as checklist facts with an
 * "AI read" label) and writes the explanation of what these rules decided.
 */
import type { ChecklistItem, EvidenceBundle, Readiness, Recommendation, Settings, Strength } from "@/lib/desk/types";
import { allowedActions, type Dispute, type DisputeAction } from "@/lib/paypal/types";
import { ruleFor, type Requirement, type RequirementKey } from "./evidence-table";
import { checkThresholds } from "./guards";

type Fact = { status: ChecklistItem["status"]; detail: string };

function photoRead(bundle: EvidenceBundle, photo: string | null | undefined) {
  if (!photo) return null;
  return bundle.photoReads.find((r) => r.photo === photo) ?? null;
}

/** Turn the gathered evidence into one fact per requirement key. */
export function factsFor(bundle: EvidenceBundle): Record<RequirementKey, Fact> {
  const { paypal, store } = bundle;
  const carrier = store.carrier;
  const delivered = carrier?.outcome === "delivered";
  const tracker = paypal.trackers[0];
  const deliveryRead = photoRead(bundle, carrier?.photo);
  const buyerRead = photoRead(bundle, store.buyerPhoto);
  const storeReplies = store.thread.filter((m) => m.from === "store");

  const fact = (ok: boolean, yes: string, no: string): Fact => ({ status: ok ? "present" : "missing", detail: ok ? yes : no });

  return {
    tracking_on_paypal: fact(Boolean(tracker), `${tracker?.carrier ?? ""} ${tracker?.number ?? ""} is on the PayPal order.`.trim(), "No tracking was added to the PayPal order."),
    carrier_delivered: carrier
      ? delivered
        ? { status: "present", detail: `${carrier.name} scan: delivered in ${carrier.scans.at(-1)?.location ?? "the destination city"}.` }
        : carrier.outcome === "returned"
          ? { status: "against", detail: `${carrier.name} could not deliver and is returning the parcel.` }
          : { status: "missing", detail: carrier.outcome === "untracked" ? "Sent by untracked post, so there is no delivery scan." : `${carrier.name} has not scanned it as delivered.` }
      : { status: "missing", detail: "No carrier record found for this order." },
    address_match: fact(
      Boolean(delivered && carrier?.deliveredToOrderAddress && paypal.shipTo),
      `Delivered to ${paypal.shipTo?.line1 ?? "the order address"}, ${paypal.shipTo?.city ?? ""}: the address on the PayPal order.`,
      delivered ? "The delivery address could not be matched to the PayPal order." : "Not delivered, so there is no address to match.",
    ),
    delivery_photo: !carrier?.photo
      ? { status: "missing", detail: "The carrier did not take a delivery photo." }
      : !deliveryRead
        ? { status: "missing", detail: "Delivery photo on file, not read yet." }
        : deliveryRead.verdict === "yes"
          ? { status: "present", detail: deliveryRead.summary }
          : { status: "against", detail: deliveryRead.summary },
    signature: fact(Boolean(carrier?.signature), `Signed for by ${carrier?.signature ?? ""}.`, "No signature was collected."),
    customer_thread: fact(store.thread.length > 0, `${store.thread.length} ${store.thread.length === 1 ? "message" : "messages"} on file with the customer.`, "No messages with the customer on file."),
    billing_match: store.risk
      ? store.risk.billingMatchesShipTo
        ? { status: "present", detail: "Billing and shipping details match." }
        : { status: "against", detail: "Billing and shipping details do not match." }
      : { status: "missing", detail: "No address check on file." },
    ip_match: fact(Boolean(store.risk?.ipMatchesShipTo), `Order placed from ${store.risk?.ipRegion ?? "the usual region"}, the same region as the delivery address.`, "Order was placed from a different region than the delivery address."),
    repeat_customer: fact((store.risk?.priorOrders ?? 0) > 0, `${store.risk?.priorOrders ?? 0} earlier ${store.risk?.priorOrders === 1 ? "order" : "orders"} from this customer without a dispute.`, "First order from this customer."),
    listing_specific: fact(Boolean(store.product?.sizeChart), "The product page has a size chart and measurements.", "The product page has no size chart or measurements for the detail in dispute."),
    packing_photo: fact(Boolean(store.packingPhoto), "Packing photo on file.", "No packing photo was taken."),
    return_policy: fact(store.returnPolicy.length > 0, "Return policy on file.", "No return policy on file."),
    seller_replied: fact(storeReplies.length > 0, "You replied to the customer and offered a fix.", "No reply to the customer on file."),
    buyer_photo: !store.buyerPhoto
      ? { status: "present", detail: "The buyer sent no photo of damage." }
      : !buyerRead
        ? { status: "missing", detail: "Buyer photo on file, not read yet." }
        : buyerRead.verdict === "yes"
          ? { status: "against", detail: buyerRead.summary }
          : { status: "present", detail: buyerRead.summary },
  };
}

export function buildChecklist(dispute: Pick<Dispute, "reason">, bundle: EvidenceBundle): ChecklistItem[] {
  const rule = ruleFor(dispute.reason);
  const facts = factsFor(bundle);
  return rule.requirements.map((req: Requirement) => {
    const fact = facts[req.key];
    const points = fact.status === "present" ? req.points : fact.status === "against" ? -(req.againstPoints ?? 0) : 0;
    return {
      key: req.key,
      label: req.label,
      status: fact.status,
      detail: fact.detail,
      source: req.source,
      required: req.required,
      points,
      evidenceType: req.evidenceType,
    };
  });
}

/** Readiness drives the block colour on the board: how much of the required evidence is in hand. */
export function readinessOf(checklist: ChecklistItem[]): Readiness {
  const required = checklist.filter((c) => c.required);
  if (!required.length) return "partial";
  const present = required.filter((c) => c.status === "present").length;
  if (present === required.length) return "ready";
  if (present === 0) return "missing";
  return "partial";
}

/** A labeled estimate from the rule points. Never shown as a fact. */
export function winLikelihood(dispute: Pick<Dispute, "reason">, checklist: ChecklistItem[]): number {
  const rule = ruleFor(dispute.reason);
  const total = rule.base + checklist.reduce((sum, c) => sum + c.points, 0);
  // A parcel the carrier is returning cannot be defended as delivered.
  const undeliverable = checklist.some((c) => c.key === "carrier_delivered" && c.status === "against");
  const capped = undeliverable ? Math.min(total, 5) : total;
  return Math.max(3, Math.min(95, Math.round(capped)));
}

export function strengthOf(likelihood: number): Strength {
  if (likelihood >= 65) return "strong";
  if (likelihood >= 35) return "partial";
  return "weak";
}

/**
 * Minutes of a person's time expected for a case. Marlow gathers the evidence and writes the
 * draft, so this is review, edit and approve time, not research time. Sizes the block on the board.
 */
export function effortMinutes(reason: string, action: Recommendation["action"], stage: string | null | undefined): number {
  const base =
    action === "accept"
      ? 10
      : action === "offer"
        ? 20
        : reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
          ? 30
          : reason === "UNAUTHORISED"
            ? 30
            : 20;
  const later = stage && stage !== "INQUIRY" ? 10 : 0;
  return base + later;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Partial refund to offer: the share you would expect to lose anyway, capped at half. */
export function offerAmountFor(amount: number, likelihood: number): number {
  const share = Math.min(0.5, 1 - likelihood / 100);
  return Math.max(1, Math.round(amount * share));
}

function pickVia(action: Recommendation["action"], allowed: DisputeAction[]): DisputeAction | null {
  const order: Record<Recommendation["action"], DisputeAction[]> = {
    fight: ["provide_evidence", "appeal", "provide_supporting_info", "send_message"],
    offer: ["make_offer"],
    accept: ["accept_claim"],
  };
  return order[action].find((a) => allowed.includes(a)) ?? null;
}

export function recommend(dispute: Dispute, checklist: ChecklistItem[], settings: Settings): Recommendation {
  const rule = ruleFor(dispute.reason);
  const amount = Number(dispute.dispute_amount?.value ?? 0);
  const likelihood = winLikelihood(dispute, checklist);
  const strength = strengthOf(likelihood);
  const allowed = allowedActions(dispute);
  const canOffer = rule.offerable && allowed.includes("make_offer");

  let action: Recommendation["action"];
  if (strength === "strong") action = "fight";
  else if (strength === "partial") action = canOffer ? "offer" : likelihood >= 50 ? "fight" : "accept";
  else action = "accept";

  // If PayPal does not currently allow the natural action, fall back to what it does allow.
  let via = pickVia(action, allowed);
  if (!via && action !== "fight") {
    const fightVia = pickVia("fight", allowed);
    if (fightVia && likelihood >= 35) {
      action = "fight";
      via = fightVia;
    }
  }

  // Economics check: never recommend a fight that is expected to cost more than giving in.
  const p0 = likelihood / 100;
  const fightNet = p0 * amount - (1 - p0) * settings.disputeFee - (effortMinutes(dispute.reason, "fight", dispute.dispute_life_cycle_stage) / 60) * settings.hourlyCost;
  const acceptNet = -(effortMinutes(dispute.reason, "accept", dispute.dispute_life_cycle_stage) / 60) * settings.hourlyCost;
  let uneconomic = false;
  if (action === "fight" && fightNet < acceptNet && allowed.includes("accept_claim")) {
    action = "accept";
    via = "accept_claim";
    uneconomic = true;
  }

  const offerAmount = action === "offer" ? offerAmountFor(amount, likelihood) : null;
  const staffMinutes = effortMinutes(dispute.reason, action, dispute.dispute_life_cycle_stage);
  const staffCost = round2((staffMinutes / 60) * settings.hourlyCost);
  const p = likelihood / 100;
  const fightMinutes = effortMinutes(dispute.reason, "fight", dispute.dispute_life_cycle_stage);
  const fightCost = round2((fightMinutes / 60) * settings.hourlyCost);

  const economics: Recommendation["economics"] = {
    amount,
    staffMinutes,
    staffCost,
    fee: settings.disputeFee,
    // Expected money kept by fighting: the amount you keep when you win, minus the fee when you
    // lose, minus the staff time either way.
    fight: round2(p * amount - (1 - p) * settings.disputeFee - fightCost),
    offer: canOffer ? round2(amount - offerAmountFor(amount, likelihood) - round2((effortMinutes(dispute.reason, "offer", dispute.dispute_life_cycle_stage) / 60) * settings.hourlyCost)) : null,
    accept: round2(-(effortMinutes(dispute.reason, "accept", dispute.dispute_life_cycle_stage) / 60) * settings.hourlyCost),
  };

  const reasons = checklist
    .filter((c) => c.points !== 0 || (c.required && c.status !== "present"))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5)
    .map((c) => (c.status === "present" ? `${c.label}: ${c.detail}` : `${c.status === "against" ? "Against you" : "Missing"}: ${c.detail}`));

  if (uneconomic) reasons.unshift("Fighting is expected to cost more in staff time and fees than it would recover.");

  const guard = checkThresholds({ action, amount, strength, settings });

  return {
    action,
    via,
    likelihood,
    strength,
    offerAmount,
    approval: guard.needsApproval ? "ask" : "auto",
    approvalReason: guard.reason,
    reasons,
    economics,
  };
}
