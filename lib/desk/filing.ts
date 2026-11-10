/**
 * Filing: the only place that sends dispute writes to PayPal.
 *
 * Order of work for every write (see paypal-plan.md):
 *   1. Re-read the dispute from PayPal.
 *   2. Guards in code: the action must be in the dispute's links, amounts and types must be ones
 *      PayPal allows, and the merchant's thresholds decide whether Marlow may act alone.
 *   3. Claim: a row keyed by dispute and action is written before the call, so a double click
 *      or a second tab cannot send the same filing twice.
 *   4. Call PayPal with a stored PayPal-Request-Id.
 *   5. Record the result. If no response arrived, re-read the dispute and report what PayPal
 *      shows, as unknown rather than failed.
 */
import { randomUUID } from "node:crypto";
import {
  acceptClaim,
  acknowledgeReturnItem,
  adjudicate,
  appealDispute,
  escalateDispute,
  getDispute,
  makeOffer,
  provideEvidence,
  provideSupportingInfo,
  requireEvidence,
  sendMessage,
  type EvidenceFile,
  type OfferType,
} from "@/lib/paypal/disputes";
import { PayPalError } from "@/lib/paypal/http";
import { isAllowed, type Dispute, type DisputeAction } from "@/lib/paypal/types";
import { checkAllowedByPayPal, checkOfferAmount, mayAutoFile, pickEvidenceType } from "@/lib/rules/guards";
import { ruleFor } from "@/lib/rules/evidence-table";
import { strengthOf } from "@/lib/rules/assess";
import { addTrail, loadCase, loadDesk, loadSettings, saveCase, saveDesk } from "./state";
import { refreshCase } from "./sync";
import type { CaseDetail, CaseMeta, Filing } from "./types";

export class DeskError extends Error {
  status: number;
  code: string;
  extra?: unknown;
  constructor(status: number, code: string, message: string, extra?: unknown) {
    super(message);
    this.name = "DeskError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type FilingPayload = {
  /** Response text: evidence notes, message body, offer note or accept note. */
  text?: string;
  offerAmount?: number;
  offerType?: OfferType;
  acknowledgementType?: string;
  outcome?: "SELLER_FAVOR" | "BUYER_FAVOR";
  files?: EvidenceFile[];
};

/** Sandbox-only endpoints are not listed in links, so they are gated on status instead. */
const SANDBOX_ONLY: DisputeAction[] = ["adjudicate", "require_evidence"];
const PENDING_TTL_MS = 90_000;

function describe(action: DisputeAction, payload: FilingPayload): string {
  switch (action) {
    case "provide_evidence":
      return `Evidence filed${payload.files?.length ? ` with ${payload.files.length} document(s)` : ""}`;
    case "provide_supporting_info":
      return `Supporting information filed${payload.files?.length ? ` with ${payload.files.length} document(s)` : ""}`;
    case "send_message":
      return "Message sent to the buyer";
    case "make_offer":
      return `Offer made: $${payload.offerAmount?.toFixed(2)} (${(payload.offerType ?? "REFUND").replace(/_/g, " ").toLowerCase()})`;
    case "accept_claim":
      return "Claim accepted: PayPal refunds the buyer";
    case "acknowledge_return_item":
      return "Returned item acknowledged";
    case "appeal":
      return "Appeal filed";
    case "escalate":
      return "Escalated to a PayPal claim";
    case "require_evidence":
      return "Sandbox: asked PayPal to request seller evidence";
    case "adjudicate":
      return `Sandbox: settled in the ${payload.outcome === "BUYER_FAVOR" ? "buyer's" : "seller's"} favor`;
  }
}

async function claimFiling(disputeId: string, action: DisputeAction, by: Filing["by"], summary: string): Promise<Filing> {
  const desk = await loadDesk();
  const key = `${disputeId}:${action}`;
  const existing = desk.filings[key];
  if (existing && existing.status === "pending" && Date.now() - new Date(existing.startedAt).getTime() < PENDING_TTL_MS) {
    throw new DeskError(409, "FILING_IN_PROGRESS", "This filing is already being sent to PayPal.", existing);
  }
  const filing: Filing = {
    key,
    disputeId,
    action,
    status: "pending",
    // A retry of the same pending filing reuses its request id so PayPal can deduplicate.
    requestId: existing?.status === "pending" || existing?.status === "unknown" ? existing.requestId : randomUUID(),
    startedAt: new Date().toISOString(),
    by,
    summary,
  };
  desk.filings[key] = filing;
  await saveDesk(desk);
  return filing;
}

async function settleFiling(filing: Filing, patch: Partial<Filing>): Promise<Filing> {
  const desk = await loadDesk();
  const next = { ...filing, ...patch, finishedAt: new Date().toISOString() };
  desk.filings[filing.key] = next;
  await saveDesk(desk);
  return next;
}

async function callPayPal(dispute: Dispute, action: DisputeAction, payload: FilingPayload, requestId: string, detail: CaseDetail | null) {
  const id = dispute.dispute_id;
  const text = (payload.text ?? "").trim();
  const opts = { requestId };
  switch (action) {
    case "provide_evidence":
    case "appeal": {
      const type = pickEvidenceType(dispute, ruleFor(dispute.reason).fileAs) ?? "OTHER";
      const tracker = detail?.evidence?.paypal.trackers[0];
      const evidence = {
        evidence_type: type,
        notes: text.slice(0, 1900) || "Evidence attached.",
        ...(type === "PROOF_OF_FULFILLMENT" && tracker
          ? { evidence_info: { tracking_info: [{ carrier_name: "OTHER", carrier_name_other: tracker.carrier, tracking_number: tracker.number }] } }
          : {}),
      };
      return action === "appeal"
        ? appealDispute(id, evidence, payload.files ?? [], opts)
        : provideEvidence(id, evidence, payload.files ?? [], opts);
    }
    case "provide_supporting_info":
      return provideSupportingInfo(id, text.slice(0, 1900) || "Supporting documents attached.", payload.files ?? [], opts);
    case "send_message":
      return sendMessage(id, text.slice(0, 1900), opts);
    case "make_offer":
      return makeOffer(
        id,
        {
          note: text.slice(0, 1900) || "We would like to offer a partial refund to settle this.",
          offer_type: payload.offerType ?? "REFUND",
          offer_amount: { currency_code: dispute.dispute_amount.currency_code, value: (payload.offerAmount ?? 0).toFixed(2) },
        },
        opts,
      );
    case "accept_claim": {
      const types = dispute.allowed_response_options?.accept_claim?.accept_claim_types ?? [];
      return acceptClaim(
        id,
        { note: text.slice(0, 1900) || "We accept this claim and agree to the refund.", ...(types.includes("REFUND") ? { accept_claim_type: "REFUND" } : {}) },
        opts,
      );
    }
    case "acknowledge_return_item":
      return acknowledgeReturnItem(id, { note: text || "We have received the returned item.", acknowledgement_type: payload.acknowledgementType ?? "ITEM_RECEIVED" }, opts);
    case "escalate":
      return escalateDispute(id, text || "We could not agree with the buyer. Please review this case.", opts);
    case "require_evidence":
      return requireEvidence(id, "SELLER_EVIDENCE", opts);
    case "adjudicate":
      return adjudicate(id, payload.outcome ?? "SELLER_FAVOR", opts);
  }
}

export type FilingResult = { filing: Filing; detail: CaseDetail; meta: CaseMeta; unknown: boolean };

export async function fileAction(input: {
  disputeId: string;
  action: DisputeAction;
  by: Filing["by"];
  payload: FilingPayload;
}): Promise<FilingResult> {
  const { disputeId, action, by, payload } = input;
  const settings = await loadSettings();

  // 1. Fresh read: the links decide.
  const dispute = await getDispute(disputeId, "File: re-read dispute before acting");
  const detail = await loadCase(disputeId);

  // 2. Guards.
  if (SANDBOX_ONLY.includes(action)) {
    if (dispute.status !== "UNDER_REVIEW" && !isAllowed(dispute, action)) {
      throw new DeskError(409, "NOT_ALLOWED", `The sandbox can only do this while PayPal is reviewing the case (status is ${dispute.status}).`);
    }
  } else {
    const allowed = checkAllowedByPayPal(dispute, action);
    if (!allowed.ok) throw new DeskError(409, "NOT_ALLOWED", allowed.reason);
  }
  const amount = Number(dispute.dispute_amount.value);
  if (action === "make_offer") {
    const check = checkOfferAmount(dispute, payload.offerAmount ?? 0);
    if (!check.ok) throw new DeskError(422, "OFFER_AMOUNT", check.reason);
    const types = dispute.allowed_response_options?.make_offer?.offer_types ?? [];
    const type = payload.offerType ?? "REFUND";
    if (types.length && !types.includes(type)) {
      throw new DeskError(422, "OFFER_TYPE", `PayPal does not allow a ${type.replace(/_/g, " ").toLowerCase()} offer on this dispute. Allowed: ${types.join(", ")}.`);
    }
  }
  if ((action === "send_message" || action === "make_offer") && !(payload.text ?? "").trim()) {
    throw new DeskError(422, "TEXT_REQUIRED", "Write the message before sending it.");
  }
  if (by === "marlow-auto") {
    const likelihood = detail?.recommendation?.likelihood ?? 100;
    const auto = mayAutoFile({ action, amount, strength: strengthOf(likelihood), settings });
    if (!auto.ok) throw new DeskError(403, "NEEDS_APPROVAL", auto.reason);
  }

  // 3. Claim.
  const filing = await claimFiling(disputeId, action, by, describe(action, payload));

  // 4. Call.
  let unknown = false;
  let settled: Filing;
  try {
    const res = await callPayPal(dispute, action, payload, filing.requestId, detail);
    settled = await settleFiling(filing, { status: "done", debugId: res?.debugId ?? null });
  } catch (err) {
    if (err instanceof PayPalError && err.unknownOutcome) {
      // 5. No response: find out what PayPal did before telling anyone anything.
      unknown = true;
      let landed = false;
      try {
        const after = await getDispute(disputeId, "File: re-read after no response");
        landed = after.update_time !== dispute.update_time || after.status !== dispute.status || !isAllowed(after, action);
      } catch {
        landed = false;
      }
      settled = await settleFiling(filing, {
        status: landed ? "done" : "unknown",
        error: landed ? undefined : "PayPal did not answer. The dispute shows no change yet, so the outcome is unknown.",
      });
      if (landed) unknown = false;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      await settleFiling(filing, { status: "refused", error: message, debugId: err instanceof PayPalError ? err.debugId : null });
      if (detail) {
        addTrail(detail, { actor: "paypal", kind: "filing", title: `PayPal refused: ${action.replace(/_/g, " ")}`, detail: message, ok: false });
        await saveCase(detail);
      }
      throw err;
    }
  }

  // Record it on the case, then re-read so the board shows PayPal's new state.
  const current = (await loadCase(disputeId)) ?? detail;
  if (current) {
    addTrail(current, {
      actor: by === "person" ? "person" : "marlow",
      kind: "filing",
      title: settled.status === "unknown" ? `${settled.summary}: outcome unknown` : settled.summary,
      detail:
        settled.status === "unknown"
          ? settled.error
          : `POST /v1/customer/disputes/${disputeId}/${action.replace(/_/g, "-")} accepted by PayPal${settled.debugId ? ` (debug id ${settled.debugId})` : ""}. ${by === "marlow-auto" ? "Sent by Marlow under your auto-accept rule." : "Approved by a person."}`,
      ok: settled.status === "done",
    });
    await saveCase(current);
  }
  const refreshed = await refreshCase(disputeId, "File: read dispute after filing");
  return { filing: settled, detail: refreshed.detail, meta: refreshed.meta, unknown };
}
