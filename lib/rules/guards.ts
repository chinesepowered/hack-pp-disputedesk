/**
 * Money guards. Every tool or route that can move money calls these in code before PayPal is
 * called. The model can propose anything; only what passes here is ever sent.
 */
import type { Recommendation, Settings, Strength } from "@/lib/desk/types";
import { isAllowed, type Dispute, type DisputeAction } from "@/lib/paypal/types";

export type GuardResult = { ok: boolean; reason: string };

/** PayPal's own list of what is possible right now always wins. */
export function checkAllowedByPayPal(dispute: Dispute | null | undefined, action: DisputeAction): GuardResult {
  if (!dispute) return { ok: false, reason: "The dispute could not be read from PayPal." };
  if (!isAllowed(dispute, action)) {
    return {
      ok: false,
      reason: `PayPal does not allow "${action.replace(/_/g, " ")}" on this dispute right now (status ${dispute.status}, stage ${dispute.dispute_life_cycle_stage ?? "unknown"}).`,
    };
  }
  return { ok: true, reason: "PayPal lists this action in the dispute's links." };
}

/**
 * Who has to approve. Auto-accept is the only thing Marlow may do alone, and only under the
 * merchant's ceiling, with weak evidence, and never above the always-ask amount.
 */
export function checkThresholds(input: {
  action: Recommendation["action"];
  amount: number;
  strength: Strength;
  settings: Pick<Settings, "autoAcceptEnabled" | "autoAcceptUnder" | "alwaysAskAbove">;
}): { needsApproval: boolean; reason: string } {
  const { action, amount, strength, settings } = input;
  if (amount > settings.alwaysAskAbove) {
    return { needsApproval: true, reason: `Above your $${settings.alwaysAskAbove} always-ask amount, so a person decides.` };
  }
  if (action === "accept") {
    if (settings.autoAcceptEnabled && amount < settings.autoAcceptUnder && strength === "weak") {
      return { needsApproval: false, reason: `Under your $${settings.autoAcceptUnder} auto-accept ceiling with weak evidence, so Marlow may accept it.` };
    }
    return { needsApproval: true, reason: "Accepting a claim refunds the buyer, so a person approves it." };
  }
  if (action === "offer") return { needsApproval: true, reason: "An offer commits you to a refund, so a person approves it." };
  return { needsApproval: true, reason: "A person reviews the response and evidence before it is filed." };
}

/** May Marlow file this action without a person? Used by the agent tools and the filing route. */
export function mayAutoFile(input: {
  action: DisputeAction;
  amount: number;
  strength: Strength;
  settings: Pick<Settings, "autoAcceptEnabled" | "autoAcceptUnder" | "alwaysAskAbove">;
}): GuardResult {
  if (input.action !== "accept_claim") {
    return { ok: false, reason: "Only accepting a claim can be automatic. Everything else needs a person's approval." };
  }
  const t = checkThresholds({ action: "accept", amount: input.amount, strength: input.strength, settings: input.settings });
  return { ok: !t.needsApproval, reason: t.reason };
}

/** An offer must be positive, in the dispute's currency and no more than PayPal allows to refund. */
export function checkOfferAmount(dispute: Dispute, offerValue: number): GuardResult {
  const ceiling = Number(dispute.refund_details?.allowed_refund_amount?.value ?? dispute.dispute_amount?.value ?? 0);
  if (!Number.isFinite(offerValue) || offerValue <= 0) return { ok: false, reason: "The offer amount must be more than zero." };
  if (Math.round(offerValue * 100) > Math.round(ceiling * 100)) {
    return { ok: false, reason: `The offer ($${offerValue.toFixed(2)}) is more than PayPal allows to refund on this dispute ($${ceiling.toFixed(2)}).` };
  }
  return { ok: true, reason: "Within the amount PayPal allows." };
}

/** Send only evidence types PayPal asked the seller for, one per call. */
export function pickEvidenceType(dispute: Dispute, preferred: string[]): string | null {
  const requested = (dispute.evidences ?? [])
    .filter((e) => e.source === "REQUESTED_FROM_SELLER" && e.evidence_type)
    .map((e) => e.evidence_type as string);
  if (!requested.length) return preferred[0] ?? null;
  return preferred.find((p) => requested.includes(p)) ?? requested[0];
}
