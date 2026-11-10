import { describe, expect, it } from "vitest";
import { recoveredThisMonth } from "@/lib/desk/board";
import { originalAmountOf, outcomeOf } from "@/lib/desk/sync";
import { EMPTY_DESK, type CaseMeta, type Desk } from "@/lib/desk/types";
import { dispute } from "./helpers";

describe("outcomes", () => {
  it("is null until PayPal resolves the case", () => {
    expect(outcomeOf(dispute("fig-not-received"))).toBeNull();
  });

  it("a case settled for the seller recovers the full amount", () => {
    const d = dispute("fig-not-received", { status: "RESOLVED", links: [] });
    d.dispute_outcome = { outcome_code: "RESOLVED_SELLER_FAVOUR" };
    expect(outcomeOf(d)).toMatchObject({ code: "RESOLVED_SELLER_FAVOUR", wonAmount: 184 });
  });

  it("a buyer win or an accepted claim recovers nothing", () => {
    const d = dispute("fig-not-received", { status: "RESOLVED", links: [] });
    d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR" };
    expect(outcomeOf(d)?.wonAmount).toBe(0);
    d.dispute_outcome = { outcome_code: "ACCEPTED" };
    expect(outcomeOf(d)?.wonAmount).toBe(0);
  });

  it("an accepted partial refund keeps the rest", () => {
    const d = dispute("planter-not-as-described", { status: "RESOLVED", links: [] });
    d.dispute_outcome = { outcome_code: "RESOLVED_WITH_PAYOUT", amount_refunded: { currency_code: "USD", value: "31.00" } };
    expect(outcomeOf(d)?.wonAmount).toBe(31);
  });

  it("keeps the original amount when PayPal rewrites it after an accepted offer", () => {
    // Recorded from the sandbox: a $62 dispute, $31 offer accepted, dispute_amount becomes 31.00.
    const d = dispute("planter-not-as-described", { status: "RESOLVED", links: [] });
    d.dispute_amount = { currency_code: "USD", value: "31.00" };
    d.disputed_transactions = [{ gross_amount: { currency_code: "USD", value: "62.00" } }];
    d.offer = { history: [{ actor: "SELLER", event_type: "PROPOSED" }, { actor: "BUYER", event_type: "ACCEPTED" }] };
    d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR", outcome_reason: "INQUIRY_OFFER_PARTIAL_REFUND", amount_refunded: { currency_code: "USD", value: "31.00" } };
    expect(originalAmountOf(d)).toBe(62);
    expect(originalAmountOf(d, 62)).toBe(62);
    expect(outcomeOf(d)).toMatchObject({ wonAmount: 31 });
  });

  it("the recovered counter adds up this month's wins only", () => {
    const meta = (id: string, won: number, resolvedAt: string): CaseMeta => ({ disputeId: id, outcome: { code: "X", wonAmount: won, resolvedAt } }) as CaseMeta;
    const desk: Desk = { ...EMPTY_DESK, cases: { a: meta("a", 184, "2026-11-10T16:00:00Z"), b: meta("b", 0, "2026-11-09T16:00:00Z"), c: meta("c", 31, "2026-11-02T10:00:00Z"), old: meta("old", 500, "2026-10-20T10:00:00Z"), open: { disputeId: "open", outcome: null } as CaseMeta } };
    expect(recoveredThisMonth(desk, "America/Los_Angeles", new Date("2026-11-10T20:00:00Z"))).toEqual({ amount: 215, won: 2, resolved: 3 });
  });
});
