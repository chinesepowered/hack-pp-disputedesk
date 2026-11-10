/**
 * Intake and refresh. PayPal is the source of truth: the desk polls the Disputes API whenever a
 * screen needs fresh state (webhooks only speed this up), and keeps a small cached copy of each
 * dispute so unchanged ones cost no extra calls.
 */
import { explainRecommendation, draftResponse } from "@/lib/ai/tasks";
import { AiUnavailableError } from "@/lib/ai/client";
import { getDispute, listDisputes } from "@/lib/paypal/disputes";
import { currentMode } from "@/lib/paypal/log";
import { allowedActions, type Dispute } from "@/lib/paypal/types";
import { buildChecklist, effortMinutes, readinessOf, recommend, strengthOf, winLikelihood } from "@/lib/rules/assess";
import { mayAutoFile, pickEvidenceType } from "@/lib/rules/guards";
import { reasonTitle, ruleFor } from "@/lib/rules/evidence-table";
import { isTracked } from "./config";
import { fillMissingPhotoReads, gatherEvidence } from "./evidence";
import { addTrail, loadCase, loadDesk, loadSettings, saveCase, updateDesk } from "./state";
import type { CaseDetail, CaseMeta, Desk, Settings } from "./types";

/** How long a case's gathered evidence is used before PayPal and the store are read again. */
const EVIDENCE_FRESH_MS = 5 * 60_000;

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** PayPal says it decides internal claims within 10 days. The desk aims to add its side in 3. */
const REVIEW_TARGET_DAYS = 3;

const SELLER_WON = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER", "DENIED"]);

/**
 * What was at stake when the dispute arrived. After a partial refund offer is accepted PayPal
 * rewrites dispute_amount to the refunded amount, so the first amount the desk saw is kept, and
 * for a case first seen after that, the disputed transaction's gross amount is used.
 */
export function originalAmountOf(dispute: Dispute, previous?: number): number {
  const amount = Number(dispute.dispute_amount?.value ?? 0);
  if (previous && previous >= amount) return previous;
  const gross = Number(dispute.disputed_transactions?.[0]?.gross_amount?.value ?? NaN);
  const accepted = (dispute.offer?.history ?? []).some((h) => h.event_type === "ACCEPTED");
  return accepted && Number.isFinite(gross) && gross > amount ? gross : amount;
}

export function outcomeOf(dispute: Dispute, atStake?: number): CaseMeta["outcome"] {
  if (dispute.status !== "RESOLVED") return null;
  const code = dispute.dispute_outcome?.outcome_code ?? "NONE";
  const amount = atStake ?? originalAmountOf(dispute);
  // What PayPal actually refunded: the outcome's own figure, else the refund transactions on
  // the dispute (an accepted partial refund offer shows up there).
  const reported = Number(dispute.dispute_outcome?.amount_refunded?.value ?? NaN);
  const transactions = dispute.refund_details?.transactions ?? [];
  const refunded = Number.isFinite(reported) ? reported : transactions.length ? transactions.reduce((sum, t) => sum + Number(t.gross_amount?.value ?? 0), 0) : NaN;
  let won = 0;
  if (SELLER_WON.has(code)) won = amount;
  else if (Number.isFinite(refunded)) won = Math.max(0, amount - refunded);
  return { code, wonAmount: Math.round(won * 100) / 100, resolvedAt: dispute.update_time ?? null };
}

/** The board's summary row for a dispute, built from PayPal's object plus what the desk has added. */
export function metaFrom(dispute: Dispute, detail: CaseDetail | null, previous: CaseMeta | undefined, settings: Settings): CaseMeta {
  const txn = dispute.disputed_transactions?.[0];
  const rec = detail?.recommendation ?? null;
  const checklist = detail?.checklist ?? [];
  const amount = originalAmountOf(dispute, previous?.amount);
  const action = rec?.action ?? null;
  const likelihood = checklist.length ? winLikelihood(dispute, checklist) : null;
  const auto =
    action === "accept" && likelihood !== null
      ? mayAutoFile({ action: "accept_claim", amount, strength: strengthOf(likelihood), settings }).ok && allowedActions(dispute).includes("accept_claim")
      : false;
  const actions = allowedActions(dispute);
  const sellerSpoke =
    (dispute.supporting_info ?? []).some((s) => s.source === "SUBMITTED_BY_SELLER") ||
    (dispute.evidences ?? []).some((e) => e.source === "SUBMITTED_BY_SELLER" && e.action_info?.action !== "ESCALATE" && e.dispute_life_cycle_stage === dispute.dispute_life_cycle_stage);
  // A claim PayPal is already reviewing has no seller deadline, but supporting information
  // only helps if it arrives before PayPal decides: the desk sets its own target for it.
  const reviewing = dispute.status === "UNDER_REVIEW" && actions.includes("provide_supporting_info") && !sellerSpoke;
  const needsSeller = dispute.status === "WAITING_FOR_SELLER_RESPONSE" || reviewing;
  const target = reviewing ? new Date(new Date(dispute.create_time).getTime() + REVIEW_TARGET_DAYS * 24 * 3600 * 1000).toISOString() : null;
  return {
    disputeId: dispute.dispute_id,
    firstSeenAt: previous?.firstSeenAt ?? new Date().toISOString(),
    createdAt: dispute.create_time,
    updateTime: dispute.update_time ?? null,
    reason: dispute.reason,
    status: dispute.status,
    stage: dispute.dispute_life_cycle_stage ?? null,
    amount,
    currency: dispute.dispute_amount?.currency_code ?? "USD",
    dueAt: dispute.seller_response_due_date ?? target,
    dueKind: dispute.seller_response_due_date ? "paypal" : target ? "target" : null,
    needsSeller: needsSeller && dispute.status !== "RESOLVED",
    customer: detail?.evidence?.paypal.shipTo?.name || txn?.buyer?.name || null,
    product: detail?.evidence?.paypal.items[0]?.name ?? txn?.items?.[0]?.item_name ?? null,
    invoiceId: detail?.evidence?.paypal.invoiceId ?? txn?.invoice_number ?? null,
    actions,
    readiness: checklist.length ? readinessOf(checklist) : null,
    likelihood,
    recommendation: action,
    effortMinutes: effortMinutes(dispute.reason, action ?? "fight", dispute.dispute_life_cycle_stage),
    agentCanHandle: auto,
    outcome: outcomeOf(dispute, amount),
    replay: currentMode() === "replay" ? true : undefined,
  };
}

/**
 * The recommendation is advice for the seller's next move. Once the seller has acted (or the
 * case is resolved) PayPal lists fewer actions, and recomputing would rewrite history, so the
 * advice that was given is kept.
 */
function reassess(detail: CaseDetail, dispute: Dispute, settings: Settings): void {
  if (!detail.evidence) return;
  detail.checklist = buildChecklist(dispute, detail.evidence);
  const actionable = allowedActions(dispute).some((a) => a !== "adjudicate" && a !== "require_evidence");
  if (detail.recommendation && !actionable) return;
  // A case the desk first sees after the seller's turn has passed is judged against the
  // actions its stage normally offers, so the card says what the rules make of the evidence.
  const usual = dispute.dispute_life_cycle_stage === "INQUIRY" ? ["accept_claim", "send_message", "make_offer", "escalate", "provide_evidence"] : ["accept_claim", "provide_evidence"];
  const basis: Dispute = actionable
    ? dispute
    : {
        ...dispute,
        links: usual.map((rel) => ({ rel, href: "", method: "POST" })),
        // PayPal rewrites the amount after an accepted offer: judge the case on what was at stake.
        dispute_amount: { ...dispute.dispute_amount, value: originalAmountOf(dispute).toFixed(2) },
      };
  const explanation = detail.recommendation?.explanation;
  const next = recommend(basis, detail.checklist, settings);
  const same = detail.recommendation && detail.recommendation.action === next.action && detail.recommendation.likelihood === next.likelihood;
  detail.recommendation = { ...next, explanation: same ? explanation : undefined };
}

function freshDetail(dispute: Dispute): CaseDetail {
  return {
    disputeId: dispute.dispute_id,
    dispute,
    syncedAt: new Date().toISOString(),
    evidence: null,
    checklist: [],
    recommendation: null,
    draft: null,
    trail: [
      {
        at: new Date().toISOString(),
        actor: "paypal",
        kind: "intake",
        title: `New dispute: ${reasonTitle(dispute.reason)}, $${dispute.dispute_amount.value}`,
        detail: `${dispute.dispute_id} arrived at stage ${dispute.dispute_life_cycle_stage ?? "unknown"} with status ${dispute.status}.`,
      },
    ],
  };
}

export type SyncResult = { desk: Desk; settings: Settings; newIds: string[]; changedIds: string[] };

/** Poll PayPal, pull details for anything new or changed, update the desk. */
export async function syncDesk(opts: { feature?: string } = {}): Promise<SyncResult> {
  // A snapshot to decide what needs re-reading. The desk itself is changed in one step at the end.
  const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
  const summaries = (await listDisputes({ feature: opts.feature ?? "Intake: poll disputes" })).filter((d) => isTracked(d.create_time));
  // Cases the desk stopped tracking (the start time moved) are dropped from its own state.
  const untracked = (cases: Desk["cases"]) =>
    Object.keys(cases).filter((id) => !isTracked(summaries.find((d) => d.dispute_id === id)?.create_time ?? cases[id].createdAt ?? undefined));
  for (const id of untracked(desk.cases)) delete desk.cases[id];
  const listed = new Map(summaries.map((s) => [s.dispute_id, s]));

  // New disputes can take minutes to show up in the list, so known ids are also re-read by id.
  const stale: string[] = [];
  for (const s of summaries) {
    const known = desk.cases[s.dispute_id];
    if (!known || known.updateTime !== (s.update_time ?? null) || known.status !== s.status) stale.push(s.dispute_id);
  }
  for (const id of Object.keys(desk.cases)) {
    if (!listed.has(id) && !desk.cases[id].outcome && !stale.includes(id)) stale.push(id);
  }

  const newIds: string[] = [];
  const changedIds: string[] = [];
  const fresh = new Map<string, { dispute: Dispute; detail: CaseDetail }>();
  await pool(stale, 4, async (id) => {
    let dispute: Dispute;
    try {
      dispute = await getDispute(id, "Intake: read dispute");
    } catch {
      return;
    }
    const existing = await loadCase(id);
    const detail = existing ?? freshDetail(dispute);
    const before = desk.cases[id];
    if (existing) {
      if (before && before.status !== dispute.status) {
        addTrail(detail, {
          actor: "paypal",
          kind: dispute.status === "RESOLVED" ? "outcome" : "note",
          title:
            dispute.status === "RESOLVED"
              ? `PayPal resolved the case: ${dispute.dispute_outcome?.outcome_code ?? "RESOLVED"}`
              : `PayPal status changed to ${dispute.status}`,
          detail: `Stage ${dispute.dispute_life_cycle_stage ?? "unknown"}. Allowed now: ${allowedActions(dispute).join(", ") || "nothing"}.`,
        });
      }
      detail.dispute = dispute;
      detail.syncedAt = new Date().toISOString();
      // PayPal's allowed actions may have changed, so the advice is checked again.
      reassess(detail, dispute, settings);
      changedIds.push(id);
    } else {
      newIds.push(id);
    }
    await saveCase(detail);
    fresh.set(id, { dispute, detail });
  });

  const updated = await updateDesk((latest) => {
    for (const id of untracked(latest.cases)) delete latest.cases[id];
    for (const [id, { dispute, detail }] of fresh) latest.cases[id] = metaFrom(dispute, detail, latest.cases[id] ?? desk.cases[id], settings);
    // Resolved cases free their slot on the board.
    latest.blocks = latest.blocks.filter((b) => latest.cases[b.disputeId]?.needsSeller);
    latest.lastSyncAt = new Date().toISOString();
  });
  return { desk: updated, settings, newIds, changedIds };
}

/** Re-read one dispute from PayPal and update its snapshot and summary. */
export async function refreshCase(id: string, feature = "Case file: read dispute"): Promise<{ detail: CaseDetail; meta: CaseMeta; settings: Settings }> {
  const [desk, settings, dispute, existing] = await Promise.all([loadDesk(), loadSettings(), getDispute(id, feature), loadCase(id)]);
  const detail = existing ?? freshDetail(dispute);
  const before = desk.cases[id];
  if (existing && before && before.status !== dispute.status) {
    addTrail(detail, {
      actor: "paypal",
      kind: dispute.status === "RESOLVED" ? "outcome" : "note",
      title: dispute.status === "RESOLVED" ? `PayPal resolved the case: ${dispute.dispute_outcome?.outcome_code ?? "RESOLVED"}` : `PayPal status changed to ${dispute.status}`,
      detail: `Stage ${dispute.dispute_life_cycle_stage ?? "unknown"}. Allowed now: ${allowedActions(dispute).join(", ") || "nothing"}.`,
    });
  }
  detail.dispute = dispute;
  detail.syncedAt = new Date().toISOString();
  reassess(detail, dispute, settings);
  await saveCase(detail);
  const meta = metaFrom(dispute, detail, before, settings);
  await updateDesk((latest) => {
    latest.cases[id] = meta;
    if (!meta.needsSeller) latest.blocks = latest.blocks.filter((b) => b.disputeId !== id);
  });
  return { detail, meta, settings };
}

/**
 * Marlow works a case: gather evidence, run the rules, then (optionally) write the explanation
 * and the draft response. Each step is added to the reasoning trail.
 */
export async function prepareCase(
  id: string,
  opts: { explain?: boolean; draft?: boolean; force?: boolean } = {},
): Promise<{ detail: CaseDetail; meta: CaseMeta }> {
  const { detail, settings } = await refreshCase(id, "Case file: read dispute");
  const dispute = detail.dispute;

  // Evidence can arrive after the dispute does (tracking added late, a new carrier scan), so
  // while the seller can still act, PayPal and the store's records are read again when the
  // copy on file is more than a few minutes old.
  const sellerCanAct = allowedActions(dispute).some((a) => a !== "adjudicate" && a !== "require_evidence");
  const age = detail.evidence ? Date.now() - new Date(detail.evidence.gatheredAt).getTime() : 0;
  let evidenceChanged = false;
  if (detail.evidence && !opts.force && sellerCanAct && age > EVIDENCE_FRESH_MS) {
    const before = detail.evidence;
    const fresh = await gatherEvidence(dispute);
    const summary = (e: typeof fresh) => JSON.stringify([e.paypal.trackers, e.paypal.captureStatus, e.paypal.sellerProtection, e.store.carrier?.outcome ?? null, e.store.carrier?.scans.length ?? 0, e.store.thread.length]);
    evidenceChanged = summary(before) !== summary(fresh);
    detail.evidence = fresh;
    if (evidenceChanged) {
      addTrail(detail, {
        actor: "marlow",
        kind: "tool",
        title: "Evidence changed since the last read",
        detail: `PayPal now shows ${fresh.paypal.trackers.length} tracker(s) on the order (was ${before.paypal.trackers.length}), capture ${fresh.paypal.captureStatus ?? "status unknown"}. The checklist and the recommendation were worked out again.`,
        ok: true,
      });
    }
  }

  if (!detail.evidence || opts.force) {
    detail.evidence = await gatherEvidence(dispute);
    const e = detail.evidence;
    addTrail(detail, {
      actor: "marlow",
      kind: "tool",
      title: "Gathered evidence from PayPal",
      detail: `Capture ${e.paypal.captureId ?? "unknown"} (${e.paypal.captureStatus ?? "status unknown"}), order ${e.paypal.orderId ?? "unknown"}, ${e.paypal.trackers.length} tracker(s), seller protection ${e.paypal.sellerProtection ?? "unknown"}. Transaction search: ${e.paypal.transactionSearch.replace(/_/g, " ")}.`,
      ok: Boolean(e.paypal.orderId),
    });
    addTrail(detail, {
      actor: "marlow",
      kind: "tool",
      title: e.store.found ? "Pulled the store's records" : "No store record found for this order",
      detail: e.store.found
        ? `${e.store.carrier?.name ?? "Carrier"} ${e.store.carrier?.outcome ?? ""}, ${e.store.carrier?.scans.length ?? 0} scans, ${e.store.thread.length} customer messages, product page and return policy.`
        : "The PayPal order has no matching store order, so only PayPal's own data is used.",
      ok: e.store.found,
    });
    for (const read of e.photoReads) {
      addTrail(detail, { actor: "marlow", kind: "ai", title: `Read photo: ${read.verdict}`, detail: `${read.question} ${read.summary}`, ai: read.ai });
    }
  }

  else {
    for (const read of await fillMissingPhotoReads(detail.evidence)) {
      addTrail(detail, { actor: "marlow", kind: "ai", title: `Read photo: ${read.verdict}`, detail: `${read.question} ${read.summary}`, ai: read.ai });
    }
  }

  const previous = detail.recommendation;
  reassess(detail, dispute, settings);
  const rec = detail.recommendation as NonNullable<CaseDetail["recommendation"]>;
  const changed = !previous || previous.action !== rec.action || previous.likelihood !== rec.likelihood;
  if (changed) {
    addTrail(detail, {
      actor: "rules",
      kind: "rule",
      title: `Rules: ${rec.action} (win estimate ${rec.likelihood}%)`,
      detail: `${readinessOf(detail.checklist)} evidence. ${rec.approvalReason}`,
    });
  }

  if (opts.explain && !rec.explanation) {
    try {
      rec.explanation = await explainRecommendation(dispute, detail.evidence, detail.checklist, rec);
      addTrail(detail, { actor: "marlow", kind: "ai", title: "Explained the recommendation", detail: rec.explanation.text, ai: rec.explanation.ai });
    } catch (err) {
      addTrail(detail, { actor: "marlow", kind: "ai", title: "Could not write the explanation", detail: err instanceof AiUnavailableError ? "The model did not answer. The rule-based reasons are shown instead." : String(err), ok: false });
    }
  }

  // A draft written from older evidence is replaced, unless a person has edited it.
  const draftIsStale = Boolean(detail.draft && !detail.draft.editedAt && (evidenceChanged || changed) && sellerCanAct);
  if (opts.draft && (!detail.draft || opts.force || draftIsStale)) {
    const evidenceType = pickEvidenceType(dispute, ruleFor(dispute.reason).fileAs);
    try {
      const draft = await draftResponse(dispute, detail.evidence, detail.checklist, rec);
      detail.draft = { letter: draft.text, evidenceType, notes: draft.text.slice(0, 1900), ai: draft.ai, generatedAt: new Date().toISOString() };
      addTrail(detail, { actor: "marlow", kind: "ai", title: "Drafted the response", detail: `${draft.text.split(/\s+/).length} words, to be filed as ${evidenceType ?? "a message"}.`, ai: draft.ai });
    } catch {
      const letter = fallbackLetter(detail);
      detail.draft = { letter, evidenceType, notes: letter.slice(0, 1900), ai: null, generatedAt: new Date().toISOString() };
      addTrail(detail, { actor: "marlow", kind: "note", title: "Drafted the response from the template", detail: "The model did not answer, so the standard letter was used.", ok: false });
    }
  }

  await saveCase(detail);
  let meta: CaseMeta | null = null;
  await updateDesk((desk) => {
    meta = metaFrom(dispute, detail, desk.cases[id], settings);
    desk.cases[id] = meta;
  });
  return { detail, meta: meta as unknown as CaseMeta };
}

/** A plain template used when the model is unavailable. Built only from present evidence. */
export function fallbackLetter(detail: CaseDetail): string {
  const present = detail.checklist.filter((c) => c.status === "present").map((c) => `- ${c.detail}`);
  const d = detail.dispute;
  return [
    "Hello,",
    "",
    `This is our response to case ${d.dispute_id} (${reasonTitle(d.reason).toLowerCase()}, $${d.dispute_amount.value}).`,
    "",
    ...present,
    "",
    "The attached evidence pack has the order, tracking and delivery details. Please let us know if anything else is needed.",
    "",
    "Thank you, Juniper & Moss",
  ].join("\n");
}
