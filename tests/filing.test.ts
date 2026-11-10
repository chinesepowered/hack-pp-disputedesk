/**
 * Filing guards, tested at the one place that sends dispute writes to PayPal. PayPal itself is
 * faked: what matters is which calls are made, with what, and which are never made.
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dispute } from "@/lib/paypal/types";
import { dispute } from "./helpers";

const calls: { fn: string; args: unknown[] }[] = [];
let current: Dispute;
let afterWrite: Dispute | null = null;
let failWith: unknown = null;

vi.mock("@/lib/paypal/disputes", () => {
  const write = (fn: string) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ fn, args });
      if (failWith) throw failWith;
      if (afterWrite) current = afterWrite;
      return { data: {}, status: 200, debugId: "debug-1" };
    });
  return {
    getDispute: vi.fn(async () => {
      calls.push({ fn: "getDispute", args: [] });
      return current;
    }),
    listDisputes: vi.fn(async () => []),
    provideEvidence: write("provideEvidence"),
    provideSupportingInfo: write("provideSupportingInfo"),
    appealDispute: write("appealDispute"),
    sendMessage: write("sendMessage"),
    makeOffer: write("makeOffer"),
    acceptClaim: write("acceptClaim"),
    acknowledgeReturnItem: write("acknowledgeReturnItem"),
    escalateDispute: write("escalateDispute"),
    requireEvidence: write("requireEvidence"),
    adjudicate: write("adjudicate"),
  };
});

let fileAction: typeof import("@/lib/desk/filing").fileAction;
let DeskError: typeof import("@/lib/desk/filing").DeskError;
let PayPalError: typeof import("@/lib/paypal/http").PayPalError;
let state: typeof import("@/lib/desk/state");

const writes = () => calls.filter((c) => c.fn !== "getDispute").map((c) => c.fn);

beforeAll(async () => {
  // The store must never point at the app's own .data folder during tests.
  process.env.DISPUTEDESK_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "disputedesk-test-"));
  ({ fileAction, DeskError } = await import("@/lib/desk/filing"));
  ({ PayPalError } = await import("@/lib/paypal/http"));
  state = await import("@/lib/desk/state");
});

beforeEach(async () => {
  calls.length = 0;
  failWith = null;
  afterWrite = null;
  current = dispute("planter-not-as-described");
  await state.saveDesk({ version: 1, cases: {}, blocks: [], filings: {}, lastSyncAt: null, notes: [] });
});

describe("fileAction", () => {
  it("refuses an action that is not in the dispute's links and never calls PayPal", async () => {
    current = dispute("planter-not-as-described", { links: ["accept_claim", "send_message"] });
    await expect(fileAction({ disputeId: current.dispute_id, action: "make_offer", by: "person", payload: { text: "hi", offerAmount: 10 } })).rejects.toMatchObject({ status: 409, code: "NOT_ALLOWED" });
    expect(writes()).toEqual([]);
  });

  it("refuses an offer above what PayPal allows to refund, before any claim or call", async () => {
    await expect(fileAction({ disputeId: current.dispute_id, action: "make_offer", by: "person", payload: { text: "offer", offerAmount: 99 } })).rejects.toMatchObject({ status: 422, code: "OFFER_AMOUNT" });
    expect(writes()).toEqual([]);
    expect(Object.keys((await state.loadDesk()).filings)).toEqual([]);
  });

  it("refuses an offer type PayPal does not list", async () => {
    await expect(fileAction({ disputeId: current.dispute_id, action: "make_offer", by: "person", payload: { text: "offer", offerAmount: 10, offerType: "REPLACEMENT_WITHOUT_REFUND" } })).rejects.toMatchObject({ code: "OFFER_TYPE" });
    expect(writes()).toEqual([]);
  });

  it("sends a valid offer once, with the amount as a two decimal string and a stored request id", async () => {
    afterWrite = dispute("planter-not-as-described", { status: "WAITING_FOR_BUYER_RESPONSE", links: ["send_message"] });
    const res = await fileAction({ disputeId: current.dispute_id, action: "make_offer", by: "person", payload: { text: "A part refund to settle.", offerAmount: 31 } });
    expect(writes()).toEqual(["makeOffer"]);
    const [, body, opts] = calls.find((c) => c.fn === "makeOffer")!.args as [string, any, any];
    expect(body.offer_amount).toEqual({ currency_code: "USD", value: "31.00" });
    expect(body.offer_type).toBe("REFUND");
    expect(opts.requestId).toBe(res.filing.requestId);
    expect(res.filing.status).toBe("done");
    expect(res.unknown).toBe(false);
  });

  it("does not let the agent accept a claim above the merchant's ceiling", async () => {
    await expect(fileAction({ disputeId: current.dispute_id, action: "accept_claim", by: "marlow-auto", payload: {} })).rejects.toMatchObject({ status: 403, code: "NEEDS_APPROVAL" });
    expect(writes()).toEqual([]);
  });

  it("does not let the agent file evidence alone at any amount", async () => {
    current = dispute("mini-succulent-not-received");
    await expect(fileAction({ disputeId: current.dispute_id, action: "provide_evidence", by: "marlow-auto", payload: { text: "x" } })).rejects.toBeInstanceOf(DeskError);
    expect(writes()).toEqual([]);
  });

  it("blocks a second filing of the same action while the first is in flight", async () => {
    const desk = await state.loadDesk();
    desk.filings[`${current.dispute_id}:send_message`] = { key: `${current.dispute_id}:send_message`, disputeId: current.dispute_id, action: "send_message", status: "pending", requestId: "req-1", startedAt: new Date().toISOString(), by: "person", summary: "Message" };
    await state.saveDesk(desk);
    await expect(fileAction({ disputeId: current.dispute_id, action: "send_message", by: "person", payload: { text: "hello" } })).rejects.toMatchObject({ status: 409, code: "FILING_IN_PROGRESS" });
    expect(writes()).toEqual([]);
  });

  it("sends one write when the same action is filed twice at the same moment", async () => {
    const send = () => fileAction({ disputeId: current.dispute_id, action: "send_message", by: "person", payload: { text: "hello" } });
    const results = await Promise.allSettled([send(), send()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 409, code: "FILING_IN_PROGRESS" });
    expect(writes()).toEqual(["sendMessage"]);
  });

  it("releases the claim when PayPal refuses, so a later attempt is not blocked", async () => {
    failWith = new PayPalError({ status: 422, code: "UNPROCESSABLE_ENTITY", message: "no", issue: "ACTION_NOT_ALLOWED_IN_CURRENT_STATE" });
    await expect(fileAction({ disputeId: current.dispute_id, action: "send_message", by: "person", payload: { text: "hello" } })).rejects.toMatchObject({ status: 422 });
    expect((await state.loadDesk()).filings[`${current.dispute_id}:send_message`].status).toBe("refused");
    failWith = null;
    const res = await fileAction({ disputeId: current.dispute_id, action: "send_message", by: "person", payload: { text: "hello again" } });
    expect(res.filing.status).toBe("done");
  });

  it("treats no response as unknown, re-reads the dispute, and reports unknown when nothing changed", async () => {
    failWith = new PayPalError({ status: 0, code: "NO_RESPONSE", message: "timeout", unknownOutcome: true });
    const res = await fileAction({ disputeId: current.dispute_id, action: "send_message", by: "person", payload: { text: "hello" } });
    expect(res.unknown).toBe(true);
    expect(res.filing.status).toBe("unknown");
    // one read before the write, one re-read after the missing answer, one refresh
    expect(calls.filter((c) => c.fn === "getDispute").length).toBeGreaterThanOrEqual(3);
  });

  it("settles an unanswered write as done when the re-read shows PayPal acted", async () => {
    failWith = new PayPalError({ status: 0, code: "NO_RESPONSE", message: "timeout", unknownOutcome: true });
    const before = current;
    let reads = 0;
    const disputes = await import("@/lib/paypal/disputes");
    vi.mocked(disputes.getDispute).mockImplementation(async () => {
      reads++;
      return reads === 1 ? before : dispute("planter-not-as-described", { status: "WAITING_FOR_BUYER_RESPONSE", links: [] });
    });
    const res = await fileAction({ disputeId: before.dispute_id, action: "send_message", by: "person", payload: { text: "hello" } });
    expect(res.unknown).toBe(false);
    expect(res.filing.status).toBe("done");
    vi.mocked(disputes.getDispute).mockImplementation(async () => current);
  });

  it("sandbox settle is only possible while PayPal is reviewing", async () => {
    await expect(fileAction({ disputeId: current.dispute_id, action: "adjudicate", by: "person", payload: { outcome: "SELLER_FAVOR" } })).rejects.toMatchObject({ status: 409 });
    expect(writes()).toEqual([]);
  });
});
