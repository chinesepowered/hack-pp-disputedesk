"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Marlow } from "@/components/marlow/Marlow";
import { ACTION_LABEL, AiTag, Button, Card, Chip, cx, dueText, fmtDate, money, OUTCOME_TEXT, READINESS_LABEL, reasonLabel, stageLabel, statusLabel } from "@/components/ui/atoms";
import { announce, api, ApiError, toast } from "@/lib/client/store";
import type { AiTag as AiTagType, CaseDetail, CaseMeta, ChecklistItem, Filing, Proposal, Recommendation, TrailStep, WorkBlock } from "@/lib/desk/types";
import type { DisputeAction } from "@/lib/paypal/types";

type Loaded = { detail: CaseDetail; meta: CaseMeta; block: WorkBlock | null; filings: Filing[] };
const TZ = "America/Los_Angeles";

const ENDPOINT: Record<DisputeAction, string> = {
  provide_evidence: "provide-evidence",
  provide_supporting_info: "provide-supporting-info",
  send_message: "send-message",
  make_offer: "make-offer",
  accept_claim: "accept-claim",
  acknowledge_return_item: "acknowledge-return-item",
  appeal: "appeal",
  escalate: "escalate",
  adjudicate: "adjudicate",
  require_evidence: "require-evidence",
};

const FILE_ACTIONS: DisputeAction[] = ["provide_evidence", "appeal", "provide_supporting_info"];

export default function CasePage({ id }: { id: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("Reading the dispute from PayPal");
  const [letter, setLetter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [offer, setOffer] = useState("");
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [ask, setAsk] = useState("");
  const [answer, setAnswer] = useState<{ text: string; ai: AiTagType | null; events: { tool: string; ok: boolean; summary: string }[] } | null>(null);
  const started = useRef(false);
  // Latest values for callbacks that outlive a render (polling, async results).
  const dirtyRef = useRef(false);
  const busyRef = useRef<string | null>(null);
  useEffect(() => {
    dirtyRef.current = dirty;
    busyRef.current = busy;
  }, [dirty, busy]);

  const apply = useCallback((next: Partial<Loaded>) => {
    setData((prev) => {
      const merged = { ...(prev ?? ({} as Loaded)), ...next } as Loaded;
      return merged;
    });
    if (next.detail?.draft && !dirtyRef.current) setLetter(next.detail.draft.letter);
    if (next.detail?.recommendation?.offerAmount != null) setOffer((v) => v || String(next.detail!.recommendation!.offerAmount));
  }, []);


  const build = useCallback(
    async (force = false) => {
      setBusy(force ? "Marlow is rebuilding the case" : "Marlow is building the case");
      try {
        const res = await api<{ detail: CaseDetail; meta: CaseMeta }>(`/api/cases/${id}/prepare`, { method: "POST", body: { explain: true, draft: true, force } });
        apply(res);
        announce(`Case built. Marlow recommends: ${res.detail.recommendation?.action ?? "no recommendation"}.`);
      } catch (err) {
        toast("error", "Marlow could not build the case", err instanceof ApiError ? err.message : undefined);
      } finally {
        setBusy(null);
      }
    },
    [id, apply],
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setBusy("Reading the dispute from PayPal");
      try {
        const res = await api<Loaded>(`/api/cases/${id}`);
        setError(null);
        apply(res);
        return res;
      } catch (err) {
        if (!quiet) setError(err instanceof ApiError ? err.message : "Could not load the case.");
        return null;
      } finally {
        if (!quiet) setBusy(null);
      }
    },
    [id, apply],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const res = await load(false);
      // First visit: Marlow builds the case straight away.
      if (res && !res.meta.outcome && (!res.detail.evidence || !res.detail.draft || !res.detail.recommendation?.explanation)) await build(false);
    })();
  }, [load, build]);

  // While PayPal is working on the case, keep polling so a settlement shows up by itself.
  const status = data?.detail.dispute.status;
  useEffect(() => {
    if (!status || status === "RESOLVED") return;
    const every = status === "UNDER_REVIEW" || status === "OPEN" ? 20_000 : 45_000;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !busyRef.current) void load(true);
    }, every);
    return () => clearInterval(timer);
  }, [status, load]);
  const outcomeCode = data?.meta.outcome?.code;
  const prevOutcome = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (outcomeCode && prevOutcome.current === undefined && data && started.current && prevOutcome.current !== outcomeCode) {
      const o = OUTCOME_TEXT(outcomeCode, data.meta.outcome!.wonAmount, data.meta.amount);
      if (seenOpen.current) toast(o.tone === "missing" ? "info" : "success", o.title, "PayPal resolved the case.");
    }
    if (data && !outcomeCode) seenOpen.current = true;
    prevOutcome.current = outcomeCode;
  }, [outcomeCode, data]);
  const seenOpen = useRef(false);

  const saveDraft = async () => {
    try {
      const res = await api<{ detail: CaseDetail }>(`/api/cases/${id}/draft`, { method: "PUT", body: { letter } });
      setDirty(false);
      apply(res);
      toast("success", "Response saved");
    } catch (err) {
      toast("error", "Could not save the response", err instanceof ApiError ? err.message : undefined);
    }
  };

  const file = async (action: DisputeAction, body: Record<string, unknown>, doing: string) => {
    setBusy(doing);
    try {
      if (dirty && FILE_ACTIONS.includes(action)) await api(`/api/cases/${id}/draft`, { method: "PUT", body: { letter } }).then(() => setDirty(false));
      const res = await api<{ filing: Filing; detail: CaseDetail; meta: CaseMeta; unknown: boolean }>(`/api/cases/${id}/file`, { method: "POST", body: { action, ...body } });
      apply({ detail: res.detail, meta: res.meta, filings: [...(data?.filings ?? []).filter((f) => f.key !== res.filing.key), res.filing] });
      if (res.unknown) toast("info", "PayPal did not answer", "The outcome is unknown. The dispute shows no change yet, so check again in a minute before retrying.");
      else toast("success", res.filing.summary, `POST /v1/customer/disputes/${id}/${ENDPOINT[action]} accepted by PayPal.`);
      setConfirmAccept(false);
      setMessage("");
    } catch (err) {
      toast("error", `PayPal did not accept: ${ACTION_LABEL[action].toLowerCase()}`, err instanceof ApiError ? `${err.message}${err.debugId ? ` Debug id ${err.debugId}.` : ""}` : undefined);
      void load(true);
    } finally {
      setBusy(null);
    }
  };

  const askMarlow = async (instruction: string) => {
    setBusy("Marlow is working the case with tools");
    setAnswer(null);
    try {
      const res = await api<{ answer: string; ai: AiTagType | null; events: { tool: string; ok: boolean; summary: string }[]; detail: CaseDetail; meta: CaseMeta }>("/api/agent/run", {
        method: "POST",
        body: { disputeId: id, instruction },
      });
      apply({ detail: res.detail, meta: res.meta });
      setAnswer({ text: res.answer, ai: res.ai, events: res.events });
      setAsk("");
      announce(`Marlow answered: ${res.answer}`);
    } catch (err) {
      toast("error", "Marlow could not finish", err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const decide = async (proposal: Proposal, decision: "approve" | "dismiss") => {
    setBusy(decision === "approve" ? "Filing with PayPal" : "Dismissing the proposal");
    try {
      const res = await api<{ detail: CaseDetail; meta: CaseMeta; filing: Filing | null }>("/api/agent/run", { method: "PUT", body: { disputeId: id, proposalId: proposal.id, decision } });
      apply({ detail: res.detail, meta: res.meta, ...(res.filing ? { filings: [...(data?.filings ?? []).filter((f) => f.key !== res.filing!.key), res.filing] } : {}) });
      if (res.filing) toast("success", res.filing.summary, `POST /v1/customer/disputes/${id}/${ENDPOINT[proposal.action]} accepted by PayPal.`);
    } catch (err) {
      toast("error", "PayPal did not accept the proposal", err instanceof ApiError ? `${err.message}${err.debugId ? ` Debug id ${err.debugId}.` : ""}` : undefined);
      void load(true);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="mx-auto max-w-xl px-6 py-8 text-center" role="alert">
        <h1 className="text-lg font-bold">This case could not be loaded</h1>
        <p className="mt-1 text-muted">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => void load(false)}>Try again</Button>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold hover:bg-sunken">Back to the board</Link>
        </div>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="grid place-items-center gap-3 py-16 text-center" role="status">
        <Marlow mood="working" size={110} />
        <p className="text-muted">{busy ?? "Loading"}…</p>
      </div>
    );
  }

  const { detail, meta, block, filings } = data;
  const d = detail.dispute;
  const e = detail.evidence;
  const rec = detail.recommendation;
  const actions = meta.actions;
  const due = dueText(meta.dueAt);
  const outcome = meta.outcome ? OUTCOME_TEXT(meta.outcome.code, meta.outcome.wonAmount, meta.amount) : null;
  const fileVia = FILE_ACTIONS.find((a) => actions.includes(a));
  const requested = (d.evidences ?? []).filter((x) => x.source === "REQUESTED_FROM_SELLER").map((x) => x.evidence_type);
  const offerTypes = d.allowed_response_options?.make_offer?.offer_types ?? [];
  const pending = (detail.proposals ?? []).filter((p) => p.status === "pending");
  const buyerWords = d.messages?.[0]?.content ?? d.evidences?.find((x) => x.source === "SUBMITTED_BY_BUYER")?.notes;

  return (
    <div className="flex flex-col gap-4" data-testid="case-page">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/" className="font-semibold text-forest-deep underline-offset-2 hover:underline">Board</Link>
        <span className="text-muted"> / Case {d.dispute_id}</span>
      </nav>

      {/* Header */}
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">
              {meta.customer ?? "Customer"} <span className="font-semibold text-muted">· {reasonLabel(d.reason)}</span>
            </h1>
            <p className="mt-0.5 text-[15px] text-muted">{meta.product ?? "Order"} · invoice {meta.invoiceId ?? "unknown"} · PayPal case {d.dispute_id}</p>
            {buyerWords && <blockquote className="mt-2 max-w-3xl border-l-4 border-line pl-3 text-[15px] italic">&ldquo;{buyerWords}&rdquo;</blockquote>}
          </div>
          <div className="text-right">
            <p className="text-[34px] font-extrabold leading-none" data-testid="case-amount">{money(meta.amount)}</p>
            <p className="mt-1 text-[13px] text-muted">at stake</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tone="slate">{stageLabel(d.dispute_life_cycle_stage)} stage</Chip>
          <Chip tone={d.status === "WAITING_FOR_SELLER_RESPONSE" ? "missing" : d.status === "RESOLVED" ? "ready" : "neutral"} data-testid="case-status">{statusLabel(d.status)}</Chip>
          {meta.readiness && <Chip tone={meta.readiness}>{READINESS_LABEL[meta.readiness]}</Chip>}
          {!outcome && meta.dueAt && (
            <Chip tone={due.urgent ? "missing" : "partial"}>
              {meta.dueKind === "target" ? "Desk target" : "PayPal deadline"} {fmtDate(meta.dueAt, TZ)} · {due.text.toLowerCase()}
            </Chip>
          )}
          {block && <Chip tone="forest">Booked {fmtDate(block.start, TZ)}</Chip>}
          {meta.replay && <Chip tone="partial">Replay</Chip>}
        </div>
        <p className="mt-3 text-[13.5px] text-muted" data-testid="allowed-actions">
          <span className="font-semibold text-ink">PayPal allows right now</span> (from the dispute&apos;s <code className="font-mono">links</code>):{" "}
          {actions.length ? actions.map((a) => ACTION_LABEL[a].toLowerCase()).join(", ") : "nothing. The next move is PayPal's or the buyer's."}
          {requested.length > 0 && <> · Evidence PayPal asked for: {requested.map((r) => (r ?? "").replace(/_/g, " ").toLowerCase()).join(", ")}</>}
        </p>
      </Card>

      {busy && (
        <Card className="flex items-center gap-3 border-forest bg-forest-tint px-4 py-3" role="status" data-testid="case-busy">
          <Marlow mood="working" size={52} />
          <p className="font-semibold text-forest-deep">{busy}…</p>
        </Card>
      )}

      {outcome && (
        <Card
          className={cx("flex flex-wrap items-center gap-4 px-5 py-4", outcome.tone === "ready" ? "border-ready-edge bg-ready-tint" : outcome.tone === "partial" ? "border-partial-edge bg-partial-tint" : "border-line bg-sunken")}
          data-testid="outcome-banner"
          role="status"
        >
          <Marlow mood={outcome.tone === "missing" ? "calm" : "success"} size={88} />
          <div className="min-w-0 flex-1">
            <p className={cx("text-2xl font-extrabold", outcome.tone === "ready" ? "text-ready" : outcome.tone === "partial" ? "text-partial" : "text-ink")} data-testid="outcome-title">{outcome.title}</p>
            <p className="text-[14.5px]">
              PayPal outcome: <code className="font-mono">{meta.outcome?.code}</code>
              {d.dispute_outcome?.outcome_reason ? ` (${d.dispute_outcome.outcome_reason.replace(/_/g, " ").toLowerCase()})` : ""}, resolved {fmtDate(meta.outcome?.resolvedAt, TZ)}.
            </p>
            <FundMovements d={d} />
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* Left: evidence */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="px-5 py-4" aria-labelledby="checklist-title" data-testid="checklist">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="checklist-title" className="text-[17px] font-bold">Evidence checklist</h2>
              <span className="text-[12.5px] text-muted">From the reason to evidence table for {reasonLabel(d.reason).toLowerCase()}</span>
            </div>
            {detail.checklist.length === 0 ? (
              <p className="mt-2 text-muted">Marlow has not gathered the evidence yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {detail.checklist.map((c) => <ChecklistRow key={c.key} c={c} detail={detail} />)}
              </ul>
            )}
          </Card>

          {e && (
            <Card className="px-5 py-4" aria-labelledby="paypal-title">
              <h2 id="paypal-title" className="text-[17px] font-bold">From PayPal</h2>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
                <dt className="text-muted">Order</dt>
                <dd><code className="font-mono text-[13px]">{e.paypal.orderId ?? "unknown"}</code> · {e.paypal.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</dd>
                <dt className="text-muted">Capture</dt>
                <dd><code className="font-mono text-[13px]">{e.paypal.captureId}</code> · {money(e.paypal.amount)} · {fmtDate(e.paypal.capturedAt, TZ)} · {e.paypal.captureStatus === "PENDING" ? "held while the dispute is open" : (e.paypal.captureStatus ?? "").toLowerCase()}</dd>
                <dt className="text-muted">Ship to</dt>
                <dd>{e.paypal.shipTo ? `${e.paypal.shipTo.name}, ${e.paypal.shipTo.line1}, ${e.paypal.shipTo.city}, ${e.paypal.shipTo.state} ${e.paypal.shipTo.postalCode}` : "not on the order"}</dd>
                <dt className="text-muted">Tracking</dt>
                <dd>{e.paypal.trackers.length ? e.paypal.trackers.map((t) => `${t.carrier} ${t.number} (${(t.status ?? "").toLowerCase()})`).join(", ") : "none on the PayPal order"}</dd>
                <dt className="text-muted">Seller protection</dt>
                <dd>{(e.paypal.sellerProtection ?? "unknown").toLowerCase().replace(/_/g, " ")}{e.paypal.sellerProtectionCategories.length ? ` for ${e.paypal.sellerProtectionCategories.map((s) => s.replace(/_/g, " ").toLowerCase()).join(" and ")}` : ""}</dd>
                <dt className="text-muted">Transaction search</dt>
                <dd>{e.paypal.transactionSearch === "found" ? "found" : "not indexed yet (the sandbox lags by up to about three hours)"}</dd>
              </dl>
              <FundMovements d={d} />
            </Card>
          )}

          {e?.store.found && (
            <Card className="px-5 py-4" aria-labelledby="store-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="store-title" className="text-[17px] font-bold">From the store&apos;s records</h2>
                <Chip title="The shop, its customers and carriers are fictional. Store dates are set relative to the sandbox payment.">Seeded demo data</Chip>
              </div>
              {e.store.carrier && (
                <div className="mt-3">
                  <h3 className="text-[14px] font-bold">{e.store.carrier.name} · {e.store.carrier.service}{e.store.carrier.signature ? ` · signed for by ${e.store.carrier.signature}` : ""}</h3>
                  {e.store.carrier.scans.length ? (
                    <ol className="mt-1.5 space-y-1 border-l-2 border-line pl-3 text-[13.5px]">
                      {e.store.carrier.scans.map((s, i) => (
                        <li key={i}><span className="text-muted">{fmtDate(s.at, TZ)}</span> · <span className={/delivered/i.test(s.status) ? "font-semibold text-ready" : /return|attempt/i.test(s.status) ? "font-semibold text-missing" : ""}>{s.status}</span>, {s.location}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-muted">No scans: this service is not tracked.</p>
                  )}
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {e.store.carrier?.photo && <Photo src={e.store.carrier.photo} title="Carrier delivery photo" read={e.photoReads.find((r) => r.photo === e.store.carrier?.photo)} />}
                {e.store.buyerPhoto && <Photo src={e.store.buyerPhoto} title="Photo sent by the buyer" read={e.photoReads.find((r) => r.photo === e.store.buyerPhoto)} />}
                {e.store.packingPhoto && <Photo src={e.store.packingPhoto} title="Packing photo" />}
                {e.store.product && <Photo src={e.store.product.photo} title="Product page" note={e.store.product.pageFacts.join(". ")} />}
              </div>
              {e.store.thread.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-[14px] font-bold">Messages with the customer</h3>
                  <ul className="mt-1.5 space-y-1.5">
                    {e.store.thread.map((m, i) => (
                      <li key={i} className={cx("max-w-[92%] rounded-xl px-3 py-2 text-[13.5px]", m.from === "store" ? "ml-auto bg-forest-tint" : "bg-sunken")}>
                        <span className="block text-[11.5px] font-semibold text-muted">{m.from === "store" ? "Juniper & Moss" : "Customer"} · {fmtDate(m.at, TZ)}</span>
                        {m.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {e.store.risk && (
                <p className="mt-3 text-[13.5px] text-muted">
                  <span className="font-semibold text-ink">Address and IP check: </span>
                  ordered from {e.store.risk.ipRegion}; billing and shipping {e.store.risk.billingMatchesShipTo ? "match" : "do not match"}; {e.store.risk.priorOrders} earlier {e.store.risk.priorOrders === 1 ? "order" : "orders"}; device {e.store.risk.deviceSeenBefore ? "seen before" : "not seen before"}.
                </p>
              )}
            </Card>
          )}
        </div>

        {/* Right: decision, draft, actions */}
        <div className="flex min-w-0 flex-col gap-4">
          {rec && <RecommendationCard rec={rec} amount={meta.amount} />}

          {!outcome && (
            <Card className="px-5 py-4" aria-labelledby="draft-title" data-testid="draft-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="draft-title" className="text-[17px] font-bold">Response and evidence pack</h2>
                <AiTag ai={detail.draft?.editedAt ? null : detail.draft?.ai} />
              </div>
              <label htmlFor="letter" className="mt-2 block text-[13px] font-semibold text-muted">Marlow&apos;s draft. Edit anything before you approve.</label>
              <textarea
                id="letter"
                value={letter}
                onChange={(ev) => {
                  setLetter(ev.target.value);
                  setDirty(true);
                }}
                rows={9}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-[14.5px] leading-relaxed"
                placeholder="Marlow writes the response here once the case is built."
                data-testid="draft-letter"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={saveDraft} disabled={!dirty || Boolean(busy)} data-testid="save-draft">Save edits</Button>
                <Button size="sm" variant="ghost" onClick={() => void build(true)} disabled={Boolean(busy)} data-testid="rebuild">Rebuild with Marlow</Button>
                {e && (
                  <>
                    <a href={`/api/cases/${id}/pack`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-forest-deep hover:bg-forest-tint" data-testid="open-pack">Open evidence pack</a>
                    <a href={`/api/cases/${id}/pack?format=pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-forest-deep hover:bg-forest-tint" data-testid="open-pack-pdf">PDF</a>
                  </>
                )}
              </div>
            </Card>
          )}

          {!outcome && (
            <Card className="px-5 py-4" aria-labelledby="act-title" data-testid="actions-card">
              <h2 id="act-title" className="text-[17px] font-bold">Approve and file</h2>
              <p className="text-[13px] text-muted">Only actions PayPal lists for this dispute are shown. Each one goes to the Disputes API when you press it.</p>

              {actions.length === 0 && (
                <p className="mt-3 rounded-lg bg-sunken px-3 py-2.5 text-[14px]" data-testid="no-actions">
                  Nothing to file right now: {statusLabel(d.status).toLowerCase()}. This page checks PayPal again every few seconds.
                  {d.status === "UNDER_REVIEW" && " In the sandbox, PayPal offers the settle action roughly 20 to 30 minutes after evidence goes in."}
                </p>
              )}

              <div className="mt-3 flex flex-col gap-3">
                {fileVia && (
                  <ActionRow endpoint={ENDPOINT[fileVia]} recommended={rec?.action === "fight"} id={id}>
                    <Button onClick={() => void file(fileVia, { text: letter, attachPack: true }, "Filing with PayPal")} disabled={Boolean(busy) || !e || !letter.trim()} data-testid="file-evidence">
                      Approve and file {fileVia === "provide_evidence" ? "evidence" : fileVia === "appeal" ? "appeal" : "supporting info"}
                    </Button>
                    <span className="text-[13px] text-muted">Sends the response above with the evidence pack PDF{fileVia === "provide_evidence" && requested.length ? `, as ${String(detail.draft?.evidenceType ?? requested[0]).replace(/_/g, " ").toLowerCase()}` : ""}.</span>
                  </ActionRow>
                )}

                {actions.includes("make_offer") && (
                  <ActionRow endpoint={ENDPOINT.make_offer} recommended={rec?.action === "offer"} id={id}>
                    <label className="flex items-center gap-2 text-[14px] font-semibold">
                      Offer $
                      <input
                        inputMode="decimal"
                        value={offer}
                        onChange={(ev) => setOffer(ev.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-24 rounded-lg border border-line bg-paper px-2 py-2 text-[15px]"
                        aria-describedby="offer-help"
                        data-testid="offer-amount"
                      />
                    </label>
                    <Button
                      variant={rec?.action === "offer" ? "primary" : "secondary"}
                      onClick={() => void file("make_offer", { text: letter, offerAmount: Number(offer), offerType: offerTypes.includes("REFUND") || !offerTypes.length ? "REFUND" : offerTypes[0] }, "Sending the offer to PayPal")}
                      disabled={Boolean(busy) || !Number(offer) || !letter.trim()}
                      data-testid="make-offer"
                    >
                      Approve and send offer
                    </Button>
                    <span id="offer-help" className="text-[13px] text-muted">A partial refund, up to {money(d.refund_details?.allowed_refund_amount?.value ?? meta.amount)}. If the buyer accepts, PayPal refunds it and closes the case.</span>
                  </ActionRow>
                )}

                {actions.includes("send_message") && (
                  <ActionRow endpoint={ENDPOINT.send_message} id={id}>
                    <label htmlFor="msg" className="sr-only">Message to the buyer</label>
                    <textarea id="msg" value={message} onChange={(ev) => setMessage(ev.target.value)} rows={2} placeholder="Message to the buyer" className="min-w-[220px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[14px]" data-testid="message-text" />
                    <Button variant="secondary" onClick={() => void file("send_message", { text: message }, "Sending the message")} disabled={Boolean(busy) || !message.trim()} data-testid="send-message">Send message</Button>
                  </ActionRow>
                )}

                {actions.includes("accept_claim") && (
                  <ActionRow endpoint={ENDPOINT.accept_claim} recommended={rec?.action === "accept"} id={id}>
                    {confirmAccept ? (
                      <>
                        <span className="text-[14px] font-semibold text-missing">Refund {money(meta.amount)} to the buyer and close the case?</span>
                        <Button variant="danger" onClick={() => void file("accept_claim", { text: rec?.action === "accept" ? letter : "" }, "Accepting the claim")} disabled={Boolean(busy)} data-testid="accept-confirm">Yes, accept and refund</Button>
                        <Button variant="ghost" onClick={() => setConfirmAccept(false)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button variant={rec?.action === "accept" ? "primary" : "secondary"} onClick={() => setConfirmAccept(true)} disabled={Boolean(busy)} data-testid="accept-claim">Accept claim</Button>
                        <span className="text-[13px] text-muted">PayPal refunds {money(meta.amount)} to the buyer.</span>
                      </>
                    )}
                  </ActionRow>
                )}

                {actions.includes("escalate") && (
                  <ActionRow endpoint={ENDPOINT.escalate} id={id}>
                    <Button variant="secondary" onClick={() => void file("escalate", { text: "We could not agree with the buyer. Please review this case." }, "Escalating to a claim")} disabled={Boolean(busy)} data-testid="escalate">Escalate to a PayPal claim</Button>
                    <span className="text-[13px] text-muted">PayPal takes over and asks for evidence.</span>
                  </ActionRow>
                )}

                {actions.includes("acknowledge_return_item") && (
                  <ActionRow endpoint={ENDPOINT.acknowledge_return_item} id={id}>
                    <Button variant="secondary" onClick={() => void file("acknowledge_return_item", { text: "We have received the returned item.", acknowledgementType: "ITEM_RECEIVED" }, "Acknowledging the return")} disabled={Boolean(busy)} data-testid="ack-return">Item came back: acknowledge</Button>
                  </ActionRow>
                )}

                {(actions.includes("adjudicate") || actions.includes("require_evidence")) && (
                  <div className="rounded-xl border border-dashed border-partial-edge bg-partial-tint px-3 py-3" data-testid="sandbox-tools">
                    <p className="text-[13px] font-bold text-partial">Sandbox only: play PayPal&apos;s reviewer</p>
                    <p className="text-[12.5px] text-partial">These endpoints exist only in the PayPal sandbox, so a full dispute can be tested end to end.</p>
                    <div className="mt-2 flex flex-col gap-2">
                      {actions.includes("adjudicate") && (
                        <ActionRow endpoint={ENDPOINT.adjudicate} id={id} plain>
                          <Button onClick={() => void file("adjudicate", { outcome: "SELLER_FAVOR" }, "Asking the sandbox to settle the case")} disabled={Boolean(busy)} data-testid="settle-seller">Settle in the seller&apos;s favor</Button>
                          <Button variant="secondary" onClick={() => void file("adjudicate", { outcome: "BUYER_FAVOR" }, "Asking the sandbox to settle the case")} disabled={Boolean(busy)} data-testid="settle-buyer">Settle for the buyer</Button>
                        </ActionRow>
                      )}
                      {actions.includes("require_evidence") && (
                        <ActionRow endpoint={ENDPOINT.require_evidence} id={id} plain>
                          <Button variant="secondary" onClick={() => void file("require_evidence", {}, "Asking PayPal to request seller evidence")} disabled={Boolean(busy)} data-testid="require-evidence">Ask the seller for evidence</Button>
                        </ActionRow>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {filings.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <h3 className="text-[14px] font-bold">Filed on this case</h3>
                  <ul className="mt-1 space-y-1 text-[13.5px]">
                    {filings.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((f) => (
                      <li key={f.key} data-testid="filing-row">
                        <span className={cx("font-semibold", f.status === "done" ? "text-ready" : f.status === "refused" ? "text-missing" : "text-partial")}>{f.status === "done" ? "Accepted by PayPal" : f.status === "refused" ? "Refused" : f.status === "unknown" ? "Outcome unknown" : "Sending"}</span>
                        {": "}{f.summary} · {fmtDate(f.finishedAt ?? f.startedAt, TZ)}{f.debugId ? ` · debug id ${f.debugId}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {!outcome && (
            <Card className="px-5 py-4" aria-labelledby="ask-title" data-testid="ask-card">
              <div className="flex items-center gap-3">
                <Marlow mood={busy ? "working" : "calm"} size={54} />
                <div>
                  <h2 id="ask-title" className="text-[17px] font-bold">Ask Marlow</h2>
                  <p className="text-[13px] text-muted">Marlow works with tools: PayPal Agent Toolkit tools to read, guarded tools to propose. Anything that moves money waits for you.</p>
                </div>
              </div>
              {pending.length > 0 && (
                <ul className="mt-3 space-y-2" aria-label="Proposals waiting for approval">
                  {pending.map((p) => (
                    <li key={p.id} className="rounded-xl border-2 border-forest bg-forest-tint px-3 py-3" data-testid="proposal">
                      <p className="text-[12.5px] font-bold uppercase tracking-wide text-forest-deep">Marlow proposes · {ACTION_LABEL[p.action]}</p>
                      <p className="mt-0.5 text-[14.5px] font-semibold">{p.why}</p>
                      <p className="mt-1 whitespace-pre-line text-[13.5px] text-muted">{p.text.length > 320 ? `${p.text.slice(0, 320)}...` : p.text}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => void decide(p, "approve")} disabled={Boolean(busy)} data-testid="proposal-approve">Approve and file</Button>
                        <Button size="sm" variant="ghost" onClick={() => void decide(p, "dismiss")} disabled={Boolean(busy)} data-testid="proposal-dismiss">Dismiss</Button>
                        <AiTag ai={p.ai} />
                        <span className="font-mono text-[11.5px] text-muted">POST /v1/customer/disputes/{id}/{ENDPOINT[p.action]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  if (!busy) void askMarlow(ask || "Work this case and propose what the rules say.");
                }}
              >
                <label htmlFor="ask" className="sr-only">Instruction for Marlow</label>
                <input id="ask" value={ask} onChange={(ev) => setAsk(ev.target.value)} placeholder="Work this case, or: book it with Sam tomorrow at 10" className="min-h-11 min-w-[220px] flex-1 rounded-lg border border-line bg-paper px-3 text-[14.5px]" data-testid="ask-input" />
                <Button type="submit" disabled={Boolean(busy)} data-testid="ask-submit">Ask Marlow</Button>
              </form>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {["Work this case", "Book this for Sam tomorrow at 10:00", "Write the buyer a short, friendly update"].map((q) => (
                  <button key={q} type="button" onClick={() => void askMarlow(q)} disabled={Boolean(busy)} className="min-h-8 rounded-full border border-line px-3 text-[12.5px] font-semibold text-forest-deep hover:bg-forest-tint disabled:text-muted">{q}</button>
                ))}
              </div>
              {answer && (
                <div className="mt-3 rounded-xl bg-sunken px-3 py-3" data-testid="agent-answer" role="status">
                  <p className="text-[14.5px] leading-relaxed">{answer.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <AiTag ai={answer.ai} />
                    <span className="text-[12px] text-muted">{answer.events.length} tool {answer.events.length === 1 ? "call" : "calls"}: {answer.events.map((ev) => ev.tool).join(", ")}</span>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="px-5 py-4" aria-labelledby="trail-title" data-testid="trail">
            <h2 id="trail-title" className="text-[17px] font-bold">Marlow&apos;s trail</h2>
            <p className="text-[13px] text-muted">Every step taken on this case, in order.</p>
            <ol className="mt-2 space-y-2">
              {detail.trail.map((s, i) => <TrailRow key={i} s={s} />)}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ActionRow({ children, endpoint, recommended, id, plain }: { children: React.ReactNode; endpoint: string; recommended?: boolean; id: string; plain?: boolean }) {
  return (
    <div className={cx("rounded-xl px-3 py-3", plain ? "" : recommended ? "border-2 border-forest bg-forest-tint" : "border border-line")}>
      {recommended && <p className="mb-1.5 text-[12.5px] font-bold uppercase tracking-wide text-forest-deep">Marlow recommends</p>}
      <div className="flex flex-wrap items-center gap-2.5">{children}</div>
      <p className="mt-1.5 font-mono text-[11.5px] text-muted" data-testid="endpoint-label">POST /v1/customer/disputes/{id}/{endpoint}</p>
    </div>
  );
}

function ChecklistRow({ c, detail }: { c: ChecklistItem; detail: CaseDetail }) {
  const read = c.source === "AI read" ? detail.evidence?.photoReads.find((r) => (c.key === "delivery_photo" ? r.photo === detail.evidence?.store.carrier?.photo : r.photo === detail.evidence?.store.buyerPhoto)) : null;
  return (
    <li className="flex items-start gap-3 py-2" data-testid={`check-${c.key}`}>
      <span
        aria-hidden="true"
        className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white", c.status === "present" ? "bg-ready-edge" : c.status === "against" ? "bg-missing-edge" : "bg-[#8b958f]")}
      >
        {c.status === "present" ? "✓" : c.status === "against" ? "!" : "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">
          {c.label} <span className="sr-only">: {c.status === "present" ? "present" : c.status === "against" ? "counts against you" : "missing"}</span>
          {c.required && <span className="ml-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">required</span>}
        </p>
        <p className="text-[13.5px] text-muted">{c.detail}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cx("text-[13px] font-bold", c.points > 0 ? "text-ready" : c.points < 0 ? "text-missing" : "text-muted")}>{c.points > 0 ? `+${c.points}` : c.points}</span>
        {read ? <AiTag ai={read.ai} /> : <span className="text-[11.5px] text-muted">{c.source}</span>}
      </div>
    </li>
  );
}

function RecommendationCard({ rec, amount }: { rec: Recommendation; amount: number }) {
  const label = rec.action === "fight" ? "Fight it" : rec.action === "offer" ? `Offer ${money(rec.offerAmount ?? 0)}` : "Accept it";
  const tone = rec.strength === "strong" ? "ready" : rec.strength === "partial" ? "partial" : "missing";
  return (
    <Card className="px-5 py-4" aria-labelledby="rec-title" data-testid="recommendation">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Recommendation</p>
          <h2 id="rec-title" className="text-2xl font-extrabold" data-testid="rec-action">{label}</h2>
        </div>
        <div className="min-w-[150px] text-right">
          <p className={cx("text-[30px] font-extrabold leading-none", tone === "ready" ? "text-ready" : tone === "partial" ? "text-partial" : "text-missing")} data-testid="rec-likelihood">{rec.likelihood}%</p>
          <p className="text-[12.5px] font-semibold text-muted">win likelihood, an estimate</p>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={`Win likelihood estimate ${rec.likelihood} percent`}>
            <div className={cx("h-full rounded-full", tone === "ready" ? "bg-ready-edge" : tone === "partial" ? "bg-partial-edge" : "bg-missing-edge")} style={{ width: `${rec.likelihood}%` }} />
          </div>
        </div>
      </div>
      {rec.explanation ? (
        <div className="mt-3">
          <p className="text-[15px] leading-relaxed" data-testid="rec-explanation">{rec.explanation.text}</p>
          <AiTag ai={rec.explanation.ai} className="mt-1.5" />
        </div>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[14.5px]">
          {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      <p className="mt-3 text-[12.5px] text-muted">The estimate and the decision come from fixed rules: each checklist item adds or removes points. The model only explains them.</p>
      <table className="mt-3 w-full border-collapse text-[14px]" data-testid="economics">
        <caption className="pb-1 text-left text-[13px] font-bold">The economics <span className="font-normal text-muted">(net of staff time and fees; accepting refunds the full amount)</span></caption>
        <tbody>
          <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">At stake</th><td className="py-1.5 text-right font-semibold">{money(amount)}</td></tr>
          <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">Staff time to respond</th><td className="py-1.5 text-right font-semibold">{rec.economics.staffMinutes} min · {money(rec.economics.staffCost)}</td></tr>
          <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">Dispute fee if a claim is lost</th><td className="py-1.5 text-right font-semibold">{money(rec.economics.fee)}</td></tr>
          <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">If you fight: expected net</th><td className={cx("py-1.5 text-right font-semibold", rec.action === "fight" && "text-ready")}>{money(rec.economics.fight)}</td></tr>
          {rec.economics.offer !== null && <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">If the offer is accepted: net</th><td className={cx("py-1.5 text-right font-semibold", rec.action === "offer" && "text-ready")}>{money(rec.economics.offer)}</td></tr>}
          <tr className="border-t border-line"><th scope="row" className="py-1.5 text-left font-medium text-muted">If you accept: net</th><td className="py-1.5 text-right font-semibold">{money(rec.economics.accept)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[13.5px]" data-testid="approval-rule">
        <span className="font-semibold">{rec.approval === "auto" ? "Marlow may act alone: " : "Needs your approval: "}</span>
        {rec.approvalReason}
      </p>
    </Card>
  );
}

function Photo({ src, title, read, note }: { src: string; title: string; read?: { verdict: string; summary: string; ai: any } | null; note?: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line">
      <img src={src} alt={read?.summary ?? title} className="h-36 w-full object-cover" loading="lazy" />
      <figcaption className="px-3 py-2 text-[13px]">
        <span className="font-bold">{title}</span>
        {read && (
          <span className="mt-0.5 block text-muted">
            {read.summary} <AiTag ai={read.ai} className="ml-0.5 align-middle" />
          </span>
        )}
        {note && <span className="mt-0.5 block text-muted">{note}</span>}
      </figcaption>
    </figure>
  );
}

function FundMovements({ d }: { d: CaseDetail["dispute"] }) {
  const moves = d.fund_movements ?? [];
  if (!moves.length) return null;
  return (
    <p className="mt-2 text-[13.5px]" data-testid="fund-movements">
      <span className="font-semibold">Money in PayPal: </span>
      {moves.map((m, i) => (
        <span key={i}>
          {i > 0 ? ", then " : ""}
          {(m.reason ?? m.type ?? "").replace(/_/g, " ").toLowerCase()} {money(m.amount?.value)} ({fmtDate(m.initiated_time, TZ)})
        </span>
      ))}
      .
    </p>
  );
}

function TrailRow({ s }: { s: TrailStep }) {
  const who = { marlow: "Marlow", rules: "Rules", paypal: "PayPal", person: "You" }[s.actor];
  return (
    <li className="flex gap-3 text-[13.5px]" data-testid="trail-step">
      <span className={cx("mt-0.5 h-fit shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold", s.actor === "marlow" ? "bg-[#f1e3d3] text-capy-dark" : s.actor === "paypal" ? "bg-slate-tint text-slate" : s.actor === "rules" ? "bg-sunken text-ink" : "bg-forest-tint text-forest-deep")}>{who}</span>
      <div className="min-w-0">
        <p className={cx("font-semibold", s.ok === false && "text-missing")}>{s.title} {s.ai && <AiTag ai={s.ai} className="ml-1 align-middle" />}</p>
        {s.detail && <p className="text-muted">{s.detail}</p>}
        <p className="text-[11.5px] text-muted">{fmtDate(s.at, TZ)}</p>
      </div>
    </li>
  );
}
