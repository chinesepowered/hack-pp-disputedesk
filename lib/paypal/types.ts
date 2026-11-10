/** The parts of PayPal's dispute object (Disputes API v1) that the desk reads. */

export type Money = { currency_code: string; value: string };

export type DisputeLink = { href: string; rel: string; method: string; encType?: string };

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "PROBLEM_WITH_REMITTANCE"
  | "OTHER";

export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";

export type DisputeStage = "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION" | "ARBITRATION";

export type DisputeOutcomeCode =
  | "RESOLVED_BUYER_FAVOUR"
  | "RESOLVED_SELLER_FAVOUR"
  | "RESOLVED_WITH_PAYOUT"
  | "CANCELED_BY_BUYER"
  | "ACCEPTED"
  | "DENIED"
  | "NONE";

export type DisputeEvidence = {
  evidence_type?: string;
  notes?: string;
  source?: string;
  date?: string;
  dispute_life_cycle_stage?: string;
  /** Set when the entry records an action rather than evidence, for example ESCALATE. */
  action_info?: { action?: string };
  documents?: { name?: string; url?: string }[];
  evidence_info?: {
    tracking_info?: { carrier_name?: string; carrier_name_other?: string; tracking_number?: string; tracking_url?: string }[];
    refund_ids?: { refund_id?: string }[];
  };
};

export type DisputedTransaction = {
  buyer_transaction_id?: string;
  seller_transaction_id?: string;
  reference_id?: string;
  create_time?: string;
  transaction_status?: string;
  gross_amount?: Money;
  invoice_number?: string;
  custom?: string;
  buyer?: { email?: string; payer_id?: string; name?: string };
  seller?: { email?: string; merchant_id?: string; name?: string };
  items?: {
    item_id?: string;
    item_name?: string;
    item_description?: string;
    item_quantity?: string;
    reason?: string;
    item_type?: string;
    notes?: string;
  }[];
  seller_protection_eligible?: boolean;
  seller_protection_type?: string;
};

export type Dispute = {
  dispute_id: string;
  create_time: string;
  update_time?: string;
  disputed_transactions?: DisputedTransaction[];
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_amount: Money;
  dispute_state?: string;
  dispute_life_cycle_stage?: DisputeStage;
  dispute_channel?: string;
  dispute_outcome?: { outcome_code?: DisputeOutcomeCode; outcome_reason?: string; amount_refunded?: Money };
  adjudications?: { type?: string; adjudication_time?: string; reason?: string; dispute_life_cycle_stage?: string }[];
  money_movements?: { affected_party?: string; amount?: Money; initiated_time?: string; type?: string; reason?: string }[];
  /** Holds placed and released on the seller's balance while the dispute runs. */
  fund_movements?: { party?: string; amount?: Money; initiated_time?: string; type?: string; reason?: string }[];
  messages?: { posted_by?: string; time_posted?: string; content?: string; documents?: { name?: string; url?: string }[] }[];
  evidences?: DisputeEvidence[];
  supporting_info?: { notes?: string; source?: string; provided_time?: string }[];
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  offer?: {
    buyer_requested_amount?: Money;
    seller_offered_amount?: Money;
    offer_type?: string;
    history?: { offer_time?: string; actor?: string; event_type?: string; offer_type?: string; offer_amount?: Money; notes?: string }[];
  };
  refund_details?: { allowed_refund_amount?: Money; transactions?: { id?: string; gross_amount?: Money; create_time?: string }[] };
  allowed_response_options?: {
    acknowledge_return_item?: { acknowledgement_types?: string[] };
    accept_claim?: { accept_claim_types?: string[] };
    make_offer?: { offer_types?: string[] };
  };
  extensions?: Record<string, unknown>;
  communication_details?: Record<string, unknown>;
  links?: DisputeLink[];
};

export type DisputeSummary = Pick<
  Dispute,
  "dispute_id" | "create_time" | "update_time" | "reason" | "status" | "dispute_amount" | "dispute_state" | "dispute_life_cycle_stage" | "seller_response_due_date" | "links"
>;

/** Every dispute action the desk knows. A button is only shown when its rel is in the dispute's links. */
export const ACTION_RELS = [
  "provide_evidence",
  "send_message",
  "make_offer",
  "accept_claim",
  "acknowledge_return_item",
  "appeal",
  "escalate",
  "provide_supporting_info",
  "require_evidence",
  "adjudicate",
] as const;

export type DisputeAction = (typeof ACTION_RELS)[number];

/** PayPal's link rel for each action. Verified against live sandbox responses (see docs/build-log.md). */
export const ACTION_PATH: Record<DisputeAction, string> = {
  provide_evidence: "provide-evidence",
  send_message: "send-message",
  make_offer: "make-offer",
  accept_claim: "accept-claim",
  acknowledge_return_item: "acknowledge-return-item",
  appeal: "appeal",
  escalate: "escalate",
  provide_supporting_info: "provide-supporting-info",
  require_evidence: "require-evidence",
  adjudicate: "adjudicate",
};

export function allowedActions(dispute: Pick<Dispute, "links"> | null | undefined): DisputeAction[] {
  const rels = new Set((dispute?.links ?? []).map((l) => l.rel.replace(/-/g, "_")));
  return ACTION_RELS.filter((a) => rels.has(a));
}

export function isAllowed(dispute: Pick<Dispute, "links"> | null | undefined, action: DisputeAction): boolean {
  return allowedActions(dispute).includes(action);
}
