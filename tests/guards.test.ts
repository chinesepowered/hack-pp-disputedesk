import { describe, expect, it } from "vitest";
import { checkAllowedByPayPal, checkOfferAmount, checkThresholds, mayAutoFile, pickEvidenceType } from "@/lib/rules/guards";
import { allowedActions } from "@/lib/paypal/types";
import { dispute, settings } from "./helpers";

describe("PayPal's links decide", () => {
  it("allows only actions listed in the dispute's links", () => {
    const d = dispute("fig-not-received", { links: ["provide_evidence", "accept_claim"] });
    expect(checkAllowedByPayPal(d, "provide_evidence").ok).toBe(true);
    expect(checkAllowedByPayPal(d, "make_offer").ok).toBe(false);
    expect(checkAllowedByPayPal(d, "make_offer").reason).toMatch(/does not allow/);
    expect(checkAllowedByPayPal(null, "accept_claim").ok).toBe(false);
  });

  it("reads rels with dashes or underscores and ignores self", () => {
    const d = dispute("fig-not-received", { links: ["provide-supporting-info", "accept_claim"] });
    expect([...allowedActions(d)].sort()).toEqual(["accept_claim", "provide_supporting_info"]);
  });
});

describe("merchant thresholds", () => {
  const base = { settings: { autoAcceptEnabled: true, autoAcceptUnder: 15, alwaysAskAbove: 200 } };

  it("auto-accepts under the ceiling only when evidence is weak", () => {
    expect(checkThresholds({ ...base, action: "accept", amount: 12, strength: "weak" }).needsApproval).toBe(false);
    expect(checkThresholds({ ...base, action: "accept", amount: 12, strength: "partial" }).needsApproval).toBe(true);
    expect(checkThresholds({ ...base, action: "accept", amount: 15, strength: "weak" }).needsApproval).toBe(true);
    expect(checkThresholds({ ...base, action: "accept", amount: 56, strength: "weak" }).needsApproval).toBe(true);
  });

  it("never auto-accepts when the rule is off", () => {
    const off = { settings: { ...base.settings, autoAcceptEnabled: false } };
    expect(checkThresholds({ ...off, action: "accept", amount: 5, strength: "weak" }).needsApproval).toBe(true);
  });

  it("always asks above the always-ask amount, even if the ceiling is misconfigured higher", () => {
    const odd = { settings: { autoAcceptEnabled: true, autoAcceptUnder: 500, alwaysAskAbove: 200 } };
    const r = checkThresholds({ ...odd, action: "accept", amount: 240, strength: "weak" });
    expect(r.needsApproval).toBe(true);
    expect(r.reason).toMatch(/always-ask/);
  });

  it("fights and offers always need a person", () => {
    expect(checkThresholds({ ...base, action: "fight", amount: 5, strength: "strong" }).needsApproval).toBe(true);
    expect(checkThresholds({ ...base, action: "offer", amount: 5, strength: "partial" }).needsApproval).toBe(true);
  });

  it("only accept_claim can ever be filed by the agent alone", () => {
    for (const action of ["provide_evidence", "make_offer", "send_message", "escalate", "appeal", "provide_supporting_info"] as const) {
      expect(mayAutoFile({ action, amount: 1, strength: "weak", settings }).ok).toBe(false);
    }
    expect(mayAutoFile({ action: "accept_claim", amount: 12, strength: "weak", settings }).ok).toBe(true);
    expect(mayAutoFile({ action: "accept_claim", amount: 12, strength: "strong", settings }).ok).toBe(false);
    expect(mayAutoFile({ action: "accept_claim", amount: 240, strength: "weak", settings }).ok).toBe(false);
  });
});

describe("offer amounts", () => {
  it("must be positive and no more than PayPal allows to refund", () => {
    const d = dispute("planter-not-as-described", { allowedRefund: "62.00" });
    expect(checkOfferAmount(d, 31).ok).toBe(true);
    expect(checkOfferAmount(d, 62).ok).toBe(true);
    expect(checkOfferAmount(d, 62.01).ok).toBe(false);
    expect(checkOfferAmount(d, 0).ok).toBe(false);
    expect(checkOfferAmount(d, -5).ok).toBe(false);
    expect(checkOfferAmount(d, Number.NaN).ok).toBe(false);
  });

  it("uses the allowed refund amount when it is lower than the dispute amount", () => {
    const d = dispute("planter-not-as-described", { allowedRefund: "40.00" });
    expect(checkOfferAmount(d, 45).ok).toBe(false);
  });
});

describe("evidence types", () => {
  it("sends a type PayPal asked for, preferring ours when it is on the list", () => {
    const d = dispute("fig-not-received");
    d.evidences = [
      { evidence_type: "PROOF_OF_REFUND", source: "REQUESTED_FROM_SELLER" },
      { evidence_type: "PROOF_OF_FULFILLMENT", source: "REQUESTED_FROM_SELLER" },
      { evidence_type: "CREATE", source: "SUBMITTED_BY_BUYER" },
    ];
    expect(pickEvidenceType(d, ["PROOF_OF_FULFILLMENT", "OTHER"])).toBe("PROOF_OF_FULFILLMENT");
    expect(pickEvidenceType(d, ["PROOF_OF_DELIVERY_SIGNATURE"])).toBe("PROOF_OF_REFUND");
  });

  it("falls back to our first choice when PayPal asked for nothing", () => {
    const d = dispute("fig-not-received");
    d.evidences = [];
    expect(pickEvidenceType(d, ["OTHER"])).toBe("OTHER");
  });
});
