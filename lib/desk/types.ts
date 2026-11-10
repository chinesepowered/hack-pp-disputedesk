import type { Dispute, DisputeAction } from "@/lib/paypal/types";

export type Person = {
  id: string;
  name: string;
  role: string;
  /** ISO weekdays this person works: 1 = Monday ... 7 = Sunday. */
  days: number[];
  /** Working hours in the store's timezone, as decimal hours (9.5 = 09:30). */
  start: number;
  end: number;
  isAgent?: boolean;
};

export type Settings = {
  /** Accept without asking when the amount is under the ceiling and the evidence is weak. */
  autoAcceptEnabled: boolean;
  autoAcceptUnder: number;
  /** Above this amount Marlow never files anything without a person approving. */
  alwaysAskAbove: number;
  /** What an hour of staff time costs, for the economics panel. */
  hourlyCost: number;
  /** PayPal's dispute fee for this account, charged on claims the seller does not win. */
  disputeFee: number;
  autoSchedule: boolean;
  timezone: string;
  team: Person[];
};

export type Readiness = "missing" | "partial" | "ready";
export type Strength = "weak" | "partial" | "strong";

export type ChecklistItem = {
  key: string;
  label: string;
  status: "present" | "missing" | "against";
  detail: string;
  source: "PayPal" | "Store records" | "AI read";
  required: boolean;
  /** Percentage points this item adds to (or takes from) the win estimate. */
  points: number;
  /** PayPal evidence_type this supports when filed. */
  evidenceType?: string;
};

export type AiTag = { model: string; kind: "vision" | "text" | "agent"; replay?: boolean; fallback?: boolean };

export type PhotoRead = {
  photo: string;
  question: string;
  verdict: "yes" | "no" | "unclear";
  summary: string;
  ai: AiTag;
};

export type CarrierScan = { at: string; status: string; location: string };

export type EvidenceBundle = {
  gatheredAt: string;
  scenarioKey: string | null;
  paypal: {
    captureId: string | null;
    orderId: string | null;
    invoiceId: string | null;
    captureStatus: string | null;
    capturedAt: string | null;
    amount: string | null;
    sellerProtection: string | null;
    sellerProtectionCategories: string[];
    items: { name: string; sku?: string; quantity: string; unitAmount: string }[];
    shipTo: { name: string; line1: string; city: string; state: string; postalCode: string; country: string } | null;
    trackers: { id?: string; number: string; carrier: string; status?: string }[];
    transactionSearch: "found" | "not_indexed_yet" | "skipped";
    payerName: string | null;
  };
  store: {
    found: boolean;
    orderPlacedAt: string | null;
    product: { sku: string; name: string; photo: string; pageFacts: string[]; sizeChart: boolean } | null;
    carrier: { name: string; service: string; trackingNumber: string | null; outcome: string; scans: CarrierScan[]; signature: string | null; photo: string | null; deliveredToOrderAddress: boolean | null } | null;
    thread: { from: "customer" | "store"; at: string; text: string }[];
    risk: { ipRegion: string; ipMatchesShipTo: boolean; billingMatchesShipTo: boolean; deviceSeenBefore: boolean; priorOrders: number; accountAgeDays: number } | null;
    packingPhoto: string | null;
    buyerPhoto: string | null;
    returnPolicy: string[];
  };
  photoReads: PhotoRead[];
};

export type Recommendation = {
  action: "fight" | "offer" | "accept";
  /** The dispute action Marlow would file, already checked against the dispute's links. */
  via: DisputeAction | null;
  likelihood: number;
  strength: Strength;
  offerAmount: number | null;
  approval: "auto" | "ask";
  approvalReason: string;
  /** Plain reasons from the rules, each tied to a checklist item. */
  reasons: string[];
  economics: {
    amount: number;
    staffMinutes: number;
    staffCost: number;
    fee: number;
    fight: number;
    offer: number | null;
    accept: number;
  };
  /** AI-written explanation of the rule outcome. The decision itself never comes from the model. */
  explanation?: { text: string; ai: AiTag };
};

export type Draft = {
  letter: string;
  evidenceType: string | null;
  notes: string;
  ai: AiTag | null;
  editedAt?: string;
  generatedAt: string;
};

export type TrailStep = {
  at: string;
  actor: "marlow" | "rules" | "paypal" | "person";
  kind: "intake" | "tool" | "rule" | "ai" | "schedule" | "filing" | "outcome" | "note";
  title: string;
  detail?: string;
  ai?: AiTag;
  ok?: boolean;
};

export type Filing = {
  key: string;
  disputeId: string;
  action: DisputeAction;
  status: "pending" | "done" | "refused" | "unknown";
  requestId: string;
  startedAt: string;
  finishedAt?: string;
  by: "person" | "marlow-auto";
  summary: string;
  debugId?: string | null;
  error?: string;
};

export type CaseMeta = {
  disputeId: string;
  firstSeenAt: string;
  updateTime: string | null;
  reason: string;
  status: string;
  stage: string | null;
  amount: number;
  currency: string;
  dueAt: string | null;
  /** paypal: seller_response_due_date. target: the desk's own target while PayPal reviews a claim. */
  dueKind: "paypal" | "target" | null;
  /** True while the next move is the seller's, so the case belongs on the board. */
  needsSeller: boolean;
  customer: string | null;
  product: string | null;
  invoiceId: string | null;
  actions: DisputeAction[];
  readiness: Readiness | null;
  likelihood: number | null;
  recommendation: Recommendation["action"] | null;
  effortMinutes: number;
  agentCanHandle: boolean;
  outcome: { code: string; wonAmount: number; resolvedAt: string | null } | null;
  /** Set when this case is served from recorded fixtures instead of the live sandbox. */
  replay?: boolean;
};

/** Something Marlow wants to file. It already passed the code guards and waits for a person. */
export type Proposal = {
  id: string;
  action: DisputeAction;
  text: string;
  offerAmount?: number;
  why: string;
  createdAt: string;
  status: "pending" | "approved" | "dismissed";
  ai: AiTag | null;
};

export type CaseDetail = {
  disputeId: string;
  dispute: Dispute;
  syncedAt: string;
  evidence: EvidenceBundle | null;
  checklist: ChecklistItem[];
  recommendation: Recommendation | null;
  draft: Draft | null;
  trail: TrailStep[];
  proposals?: Proposal[];
};

export type WorkBlock = {
  id: string;
  disputeId: string;
  resourceId: string;
  start: string;
  end: string;
  /** Pinned blocks were placed by a person and are never moved by the scheduler. */
  pinned: boolean;
  why: string;
};

export type Desk = {
  version: 1;
  cases: Record<string, CaseMeta>;
  blocks: WorkBlock[];
  filings: Record<string, Filing>;
  lastSyncAt: string | null;
  notes: { at: string; text: string }[];
};

export const EMPTY_DESK: Desk = { version: 1, cases: {}, blocks: [], filings: {}, lastSyncAt: null, notes: [] };

export const DEFAULT_SETTINGS: Settings = {
  autoAcceptEnabled: true,
  autoAcceptUnder: 15,
  alwaysAskAbove: 200,
  hourlyCost: 28,
  disputeFee: 15,
  autoSchedule: true,
  timezone: "America/Los_Angeles",
  team: [
    { id: "sam", name: "Sam Okafor", role: "Owner", days: [1, 2, 3, 4, 5], start: 9, end: 17 },
    { id: "jo", name: "Jo Nakamura", role: "Customer care", days: [2, 3, 4, 5, 6], start: 10, end: 16 },
    { id: "dee", name: "Dee Alvarez", role: "Fulfilment", days: [1, 2, 3, 4], start: 8, end: 12 },
    { id: "marlow", name: "Marlow", role: "Agent", days: [1, 2, 3, 4, 5, 6, 7], start: 7, end: 19, isAgent: true },
  ],
};
