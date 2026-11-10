/**
 * PayPal Disputes API v1 (plain REST: the server SDK does not cover disputes).
 *
 * Docs: https://developer.paypal.com/docs/api/customer-disputes/v1/
 * Every write goes through the dispute's HATEOAS links first (see lib/desk/actions.ts): PayPal
 * refuses actions the current state does not allow (ACTION_NOT_ALLOWED_IN_CURRENT_STATE).
 */
import { paypalRequest } from "./http";
import type { Dispute, DisputeSummary, Money } from "./types";

const BASE = "/v1/customer/disputes";

export async function listDisputes(opts: {
  feature?: string;
  updateTimeAfter?: string;
  startTime?: string;
  disputeState?: string;
  pageSize?: number;
  maxPages?: number;
} = {}): Promise<DisputeSummary[]> {
  const out: DisputeSummary[] = [];
  let query: Record<string, string | number | undefined> | undefined = {
    page_size: opts.pageSize ?? 50,
    update_time_after: opts.updateTimeAfter,
    start_time: opts.startTime,
    dispute_state: opts.disputeState,
  };
  let path = BASE;
  for (let page = 0; page < (opts.maxPages ?? 5); page++) {
    const res: { data: { items?: DisputeSummary[]; links?: { rel: string; href: string }[] } } = await paypalRequest({
      method: "GET",
      path,
      query,
      feature: opts.feature ?? "Intake: poll disputes",
    });
    out.push(...(res.data.items ?? []));
    const next = res.data.links?.find((l) => l.rel === "next");
    if (!next) break;
    const url = new URL(next.href);
    path = url.pathname;
    query = Object.fromEntries(url.searchParams.entries());
  }
  return out;
}

export async function getDispute(id: string, feature = "Case file: read dispute"): Promise<Dispute> {
  const res = await paypalRequest<Dispute>({ method: "GET", path: `${BASE}/${encodeURIComponent(id)}`, feature });
  return res.data;
}

export type EvidenceFile = { name: string; type: string; data: Uint8Array };

export type EvidenceInput = {
  evidence_type: string;
  notes?: string;
  evidence_info?: {
    tracking_info?: { carrier_name: string; carrier_name_other?: string; tracking_number: string; tracking_url?: string }[];
    refund_ids?: { refund_id: string }[];
  };
};

function inputForm(input: unknown, files: EvidenceFile[] = []): () => FormData {
  return () => {
    const form = new FormData();
    // PayPal expects a JSON part named "input" followed by the document parts.
    form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
    files.forEach((f, i) => {
      form.append(`file${i + 1}`, new Blob([f.data as BlobPart], { type: f.type }), f.name);
    });
    return form;
  };
}

/** POST provide-evidence. Multipart: a JSON "input" part plus files. One evidence type per call. */
export async function provideEvidence(
  id: string,
  evidence: EvidenceInput,
  files: EvidenceFile[],
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest<{ links?: unknown[] }>({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/provide-evidence`,
    form: inputForm({ evidences: [evidence] }, files),
    requestId: opts.requestId,
    feature: opts.feature ?? "File: provide evidence",
  });
}

export async function appealDispute(
  id: string,
  evidence: EvidenceInput,
  files: EvidenceFile[],
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/appeal`,
    form: inputForm({ evidences: [evidence] }, files),
    requestId: opts.requestId,
    feature: opts.feature ?? "File: appeal",
  });
}

export async function sendMessage(id: string, message: string, opts: { requestId?: string; feature?: string } = {}) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/send-message`,
    json: { message },
    requestId: opts.requestId,
    feature: opts.feature ?? "File: send message",
  });
}

export type OfferType = "REFUND" | "REFUND_WITH_RETURN" | "REFUND_WITH_REPLACEMENT" | "REPLACEMENT_WITHOUT_REFUND";

export async function makeOffer(
  id: string,
  offer: { note: string; offer_type: OfferType; offer_amount?: Money; return_shipping_address?: Record<string, string>; invoice_id?: string },
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/make-offer`,
    json: offer,
    requestId: opts.requestId,
    feature: opts.feature ?? "File: make offer",
  });
}

export async function acceptClaim(
  id: string,
  body: { note: string; accept_claim_reason?: string; accept_claim_type?: string; refund_amount?: Money; invoice_id?: string },
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/accept-claim`,
    json: body,
    requestId: opts.requestId,
    feature: opts.feature ?? "File: accept claim",
  });
}

export async function acknowledgeReturnItem(
  id: string,
  body: { note: string; acknowledgement_type: string },
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/acknowledge-return-item`,
    json: body,
    requestId: opts.requestId,
    feature: opts.feature ?? "File: acknowledge returned item",
  });
}

export async function escalateDispute(id: string, note: string, opts: { requestId?: string; feature?: string } = {}) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/escalate`,
    json: { note },
    requestId: opts.requestId,
    feature: opts.feature ?? "File: escalate to claim",
  });
}

/** POST provide-supporting-info: notes plus documents for a claim PayPal is already reviewing. */
export async function provideSupportingInfo(
  id: string,
  notes: string,
  files: EvidenceFile[] = [],
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/provide-supporting-info`,
    form: inputForm({ notes }, files),
    requestId: opts.requestId,
    feature: opts.feature ?? "File: supporting info",
  });
}

/** Sandbox only. Moves a case from UNDER_REVIEW to waiting on the seller (or buyer) for evidence. */
export async function requireEvidence(
  id: string,
  action: "SELLER_EVIDENCE" | "BUYER_EVIDENCE",
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/require-evidence`,
    json: { action },
    requestId: opts.requestId,
    feature: opts.feature ?? "Sandbox: require evidence",
  });
}

/** Sandbox only. "Settle dispute": plays the PayPal agent who decides the case. */
export async function adjudicate(
  id: string,
  outcome: "SELLER_FAVOR" | "BUYER_FAVOR",
  opts: { requestId?: string; feature?: string } = {},
) {
  return paypalRequest({
    method: "POST",
    path: `${BASE}/${encodeURIComponent(id)}/adjudicate`,
    json: { adjudication_outcome: outcome },
    requestId: opts.requestId,
    feature: opts.feature ?? "Sandbox: settle dispute",
  });
}
