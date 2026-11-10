import { describe, expect, it } from "vitest";
import { buildChecklist, effortMinutes, offerAmountFor, readinessOf, recommend, strengthOf, winLikelihood } from "@/lib/rules/assess";
import { EVIDENCE_TABLE, ruleFor } from "@/lib/rules/evidence-table";
import { bundle, dispute, settings } from "./helpers";

const assess = (key: string, reads = {}, opts = {}) => {
  const d = dispute(key, opts);
  const checklist = buildChecklist(d, bundle(key, reads));
  return { d, checklist, rec: recommend(d, checklist, settings) };
};

describe("reason to evidence table", () => {
  it("covers the three seeded reasons and falls back for anything else", () => {
    expect(ruleFor("MERCHANDISE_OR_SERVICE_NOT_RECEIVED").title).toBe("Item not received");
    expect(ruleFor("UNAUTHORISED").offerable).toBe(false);
    expect(ruleFor("SOMETHING_NEW").reason).toBe("OTHER");
  });

  it("can never score above 95 or below 3", () => {
    for (const rule of EVIDENCE_TABLE) {
      const max = rule.base + rule.requirements.reduce((s, r) => s + r.points, 0);
      expect(max).toBeGreaterThanOrEqual(50);
      expect(Math.min(95, max)).toBeLessThanOrEqual(95);
    }
  });
});

describe("win estimate and readiness", () => {
  it("signed delivery to the matching address on a not received claim is strong", () => {
    const { checklist, rec, d } = assess("fig-not-received", { delivery: "yes" });
    expect(readinessOf(checklist)).toBe("ready");
    expect(winLikelihood(d, checklist)).toBe(95);
    expect(rec.action).toBe("fight");
    expect(rec.strength).toBe("strong");
  });

  it("an untracked parcel has nothing to defend with", () => {
    const { checklist, rec, d } = assess("mini-succulent-not-received");
    expect(readinessOf(checklist)).toBe("missing");
    expect(winLikelihood(d, checklist)).toBeLessThanOrEqual(10);
    expect(rec.action).toBe("accept");
  });

  it("a parcel the carrier is returning is capped at 5 percent whatever else is on file", () => {
    const { checklist, rec, d } = assess("watering-can-returned");
    expect(winLikelihood(d, checklist)).toBeLessThanOrEqual(5);
    expect(rec.action).toBe("accept");
    expect(rec.approval).toBe("ask"); // $56 is above the auto-accept ceiling
  });

  it("a delivery photo that does not show the parcel counts against the case", () => {
    const clear = assess("terracotta-set-not-received", { delivery: "yes" });
    const unclear = assess("terracotta-set-not-received", { delivery: "no" });
    expect(unclear.rec.likelihood).toBeLessThan(clear.rec.likelihood);
    expect(unclear.checklist.find((c) => c.key === "delivery_photo")?.status).toBe("against");
  });

  it("a thin product page makes a not as described claim partial, so the rules offer", () => {
    const { rec, checklist } = assess("planter-not-as-described");
    expect(readinessOf(checklist)).toBe("partial");
    expect(rec.action).toBe("offer");
    expect(rec.via).toBe("make_offer");
    expect(rec.offerAmount).toBe(31); // half of $62, the cap
    expect(rec.approval).toBe("ask");
  });

  it("a buyer photo showing damage takes points off", () => {
    const damaged = assess("monstera-damaged", { damage: "yes" });
    const fine = assess("monstera-damaged", { damage: "no" });
    expect(damaged.rec.likelihood).toBe(fine.rec.likelihood - 25);
  });

  it("mismatched billing on an unauthorized claim is weak, and offers are never made for fraud claims", () => {
    const { rec } = assess("snake-plant-unauthorized", {}, { links: ["accept_claim", "provide_evidence"] });
    expect(rec.action).not.toBe("offer");
    expect(rec.likelihood).toBeLessThan(50);
  });

  it("thresholds for strength are 35 and 65", () => {
    expect(strengthOf(34)).toBe("weak");
    expect(strengthOf(35)).toBe("partial");
    expect(strengthOf(64)).toBe("partial");
    expect(strengthOf(65)).toBe("strong");
  });
});

describe("recommendation respects what PayPal allows", () => {
  it("uses supporting info when PayPal is already reviewing the claim", () => {
    const { rec } = assess("fig-not-received", { delivery: "yes" }, { links: ["provide_supporting_info", "accept_claim"], stage: "CHARGEBACK", status: "UNDER_REVIEW" });
    expect(rec.action).toBe("fight");
    expect(rec.via).toBe("provide_supporting_info");
  });

  it("does not recommend an offer when make_offer is not in the links", () => {
    const { rec } = assess("planter-not-as-described", {}, { links: ["accept_claim", "send_message"] });
    expect(rec.action).not.toBe("offer");
    expect(rec.offerAmount).toBeNull();
  });

  it("has no action to file when PayPal lists none", () => {
    const { rec } = assess("fig-not-received", { delivery: "yes" }, { links: [] });
    expect(rec.via).toBeNull();
  });
});

describe("economics", () => {
  it("offer amount is the share you expect to lose, capped at half, at least one dollar", () => {
    expect(offerAmountFor(62, 45)).toBe(31);
    expect(offerAmountFor(28, 60)).toBe(11);
    expect(offerAmountFor(1, 90)).toBe(1);
  });

  it("fight value is win chance times amount, minus fee risk and staff time", () => {
    const { rec } = assess("fig-not-received", { delivery: "yes" });
    const minutes = effortMinutes("MERCHANDISE_OR_SERVICE_NOT_RECEIVED", "fight", "INQUIRY");
    const expected = 0.95 * 184 - 0.05 * settings.disputeFee - (minutes / 60) * settings.hourlyCost;
    expect(rec.economics.fight).toBeCloseTo(expected, 2);
    expect(rec.economics.amount).toBe(184);
  });

  it("never recommends a fight that costs more than giving in", () => {
    const d = dispute("terracotta-pot-not-received");
    const checklist = buildChecklist(d, bundle("terracotta-pot-not-received"));
    const costly = recommend(d, checklist, { ...settings, hourlyCost: 400 });
    expect(costly.action).toBe("accept");
    expect(costly.reasons[0]).toMatch(/cost more/);
  });

  it("later stages take longer", () => {
    expect(effortMinutes("UNAUTHORISED", "fight", "CHARGEBACK")).toBeGreaterThan(effortMinutes("UNAUTHORISED", "fight", "INQUIRY"));
  });
});
