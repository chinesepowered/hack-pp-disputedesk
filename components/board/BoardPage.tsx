"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Marlow, type MarlowMood } from "@/components/marlow/Marlow";
import { AiTag, Button, Card, Chip, cx, dueText, fmtDate, money, OUTCOME_TEXT, READINESS_LABEL, reasonLabel, stageLabel, statusLabel } from "@/components/ui/atoms";
import { announce, api, ApiError, say, setMode, toast } from "@/lib/client/store";
import type { BoardView } from "@/lib/desk/board";
import type { AiTag as AiTagType, CaseMeta } from "@/lib/desk/types";

// Bryntum touches the DOM at import time, so the board is loaded in the browser only.
const SchedulerBoard = dynamic(() => import("./SchedulerBoard"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[326px] place-items-center rounded-[14px] border border-line bg-surface text-muted" role="status">
      Loading the board…
    </div>
  ),
});

type Note = { text: string; ai: AiTagType | null; mood: MarlowMood };
type Pool = { untouched: number; low: boolean; replayCases: { disputeId: string; label: string }[] };

export default function BoardPage() {
  const router = useRouter();
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("Checking PayPal for disputes");
  const [note, setNote] = useState<Note>({ text: "Checking PayPal for disputes.", ai: null, mood: "working" });
  const [justBooked, setJustBooked] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const working = useRef(false);

  const fail = (err: unknown, fallback: string) => {
    const message = err instanceof ApiError ? err.message : fallback;
    toast("error", fallback, message === fallback ? undefined : message);
  };

  /** Marlow reads new disputes (evidence and rules, no drafting yet) so blocks get their colour. */
  const assess = useCallback(async (view: BoardView): Promise<BoardView> => {
    const todo = view.cases.filter((c) => c.readiness === null && !c.outcome);
    if (!todo.length) return view;
    setBusy(`Marlow is reading ${todo.length} ${todo.length === 1 ? "dispute" : "disputes"}`);
    setNote({ text: `Reading ${todo.length} ${todo.length === 1 ? "dispute" : "disputes"}: pulling the order, tracking and delivery photos for each.`, ai: null, mood: "working" });
    let next = view;
    const queue = [...todo];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        try {
          const res = await api<{ meta: CaseMeta }>(`/api/cases/${c.disputeId}/prepare`, { method: "POST", body: { explain: false, draft: false } });
          next = { ...next, cases: next.cases.map((x) => (x.disputeId === res.meta.disputeId ? res.meta : x)) };
          setBoard(next);
        } catch {
          // One unreadable case should not stop the rest. It stays grey and can be opened by hand.
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return next;
  }, []);

  const schedule = useCallback(async (reflow = false) => {
    setBusy("Marlow is booking time");
    try {
      const res = await api<{ board: BoardView; placements: { disputeId: string; block: unknown; why: string }[]; note: { text: string; ai: AiTagType | null } | null }>("/api/board/schedule", {
        method: "POST",
        body: { reflow, explain: true },
      });
      const booked = res.placements.filter((p) => p.block).map((p) => p.disputeId);
      setJustBooked(booked);
      setBoard(res.board);
      if (res.note) {
        setNote({ text: res.note.text, ai: res.note.ai, mood: "success" });
        announce(`Marlow booked ${booked.length} ${booked.length === 1 ? "dispute" : "disputes"}. ${res.note.text}`);
        if (booked.length) say("intake");
      }
      const missed = res.placements.filter((p) => !p.block);
      if (missed.length) toast("error", `${missed.length} could not be booked`, missed[0].why);
    } catch (err) {
      fail(err, "Marlow could not book the time");
    } finally {
      setBusy(null);
    }
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      if (working.current) return;
      working.current = true;
      if (!quiet) setBusy("Checking PayPal for disputes");
      try {
        const res = await api<{ board: BoardView; newIds: string[]; pool: Pool }>("/api/board");
        setError(null);
        setBoard(res.board);
        setPool(res.pool);
        let view = res.board;
        if (res.newIds.length && quiet) toast("info", `${res.newIds.length} new ${res.newIds.length === 1 ? "dispute" : "disputes"} from PayPal`, "Marlow is reading them now.");
        view = await assess(view);
        if (view.unscheduled.length && view.autoSchedule) {
          await schedule(false);
        } else if (!quiet || res.newIds.length) {
          const needs = view.cases.filter((c) => c.needsSeller).length;
          setNote(
            view.cases.length === 0
              ? { text: "No disputes. I will keep watching PayPal and book time the moment one lands.", ai: null, mood: "empty" }
              : needs === 0
                ? { text: "Nothing needs you right now. Everything open is with PayPal or the buyer.", ai: null, mood: "empty" }
                : { text: `${needs} ${needs === 1 ? "dispute needs" : "disputes need"} a response. Each one has time booked before its deadline.`, ai: null, mood: "calm" },
          );
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Could not load the board.";
        setError(message);
        setNote({ text: "I could not reach PayPal just now. Try again, or switch to Replay to see the recorded flow.", ai: null, mood: "calm" });
      } finally {
        setBusy(null);
        working.current = false;
      }
    },
    [assess, schedule],
  );

  useEffect(() => {
    const first = setTimeout(() => void load(false), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const onMove = useCallback(async (input: { disputeId: string; resourceId: string; start: string; end: string }) => {
    try {
      const res = await api<{ board: BoardView; note: { text: string; ai: AiTagType | null } | null }>("/api/board/blocks", { method: "PUT", body: input });
      setJustBooked([]);
      setBoard(res.board);
      const who = res.board.team.find((p) => p.id === input.resourceId)?.name.split(" ")[0] ?? "the board";
      const text = `Pinned to ${who}, ${fmtDate(input.start, res.board.timezone)}. I moved the other blocks around it.`;
      setNote({ text, ai: null, mood: "calm" });
      announce(text);
    } catch (err) {
      fail(err, "Could not move the block");
      void load(true);
    }
  }, [load]);

  const onUnschedule = useCallback(async (disputeId: string) => {
    try {
      const res = await api<{ board: BoardView }>(`/api/board/blocks?disputeId=${encodeURIComponent(disputeId)}`, { method: "DELETE" });
      setBoard(res.board);
      announce("Block removed. The dispute is back in Unscheduled.");
    } catch (err) {
      fail(err, "Could not unschedule the block");
    }
  }, []);

  const onOpen = useCallback((id: string) => router.push(`/cases/${id}`), [router]);

  const caseById = (id: string) => board?.cases.find((c) => c.disputeId === id);
  const selectedCase = selected ? caseById(selected) : null;
  const needs = board?.cases.filter((c) => c.needsSeller).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-stretch gap-3">
        <Card className="flex min-w-[280px] flex-1 items-center gap-4 px-4 py-3" aria-label="Marlow" data-testid="marlow-card">
          <Marlow mood={busy ? "working" : note.mood} size={76} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">Triage board</h1>
            <p className="mt-0.5 text-[14.5px] leading-snug" data-testid="marlow-note">
              <span className="font-semibold text-capy-dark">Marlow: </span>
              {busy ? `${busy}…` : note.text} {!busy && <AiTag ai={note.ai} className="ml-1 align-middle" />}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void load(false)} disabled={Boolean(busy)} data-testid="sync-button">
                Check PayPal now
              </Button>
              {board && board.unscheduled.length > 0 && (
                <Button size="sm" onClick={() => void schedule(false)} disabled={Boolean(busy)} data-testid="schedule-button">
                  Let Marlow book {board.unscheduled.length === 1 ? "it" : `all ${board.unscheduled.length}`}
                </Button>
              )}
              {board && board.blocks.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => void schedule(true)} disabled={Boolean(busy)} data-testid="reflow-button">
                  Reflow around pinned blocks
                </Button>
              )}
            </div>
          </div>
        </Card>
        <Card className="flex min-w-[220px] flex-1 flex-col justify-center px-5 py-3 sm:flex-none" aria-label="Recovered this month" data-testid="recovered-card">
          <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Recovered this month</p>
          <p className="text-[34px] font-extrabold leading-tight text-ready" data-testid="recovered-amount" aria-live="polite">
            {money(board?.recovered.amount ?? 0)}
          </p>
          <p className="text-[13px] text-muted">
            {board?.recovered.won ?? 0} won of {board?.recovered.resolved ?? 0} resolved
          </p>
        </Card>
        <Card className="grid min-w-[240px] flex-1 grid-cols-3 items-center gap-2 px-4 py-3 text-center sm:flex-none" aria-label="Open disputes">
          <Stat label="Need you" value={needs} tone="missing" />
          <Stat label="With PayPal" value={board?.waiting.length ?? 0} tone="slate" />
          <Stat label="Resolved" value={board?.resolved.length ?? 0} tone="ready" />
        </Card>
      </div>

      {error && (
        <Card className="border-missing-edge bg-missing-tint px-4 py-3 text-missing" role="alert">
          <p className="font-bold">The board could not be loaded.</p>
          <p className="text-sm">{error}</p>
        </Card>
      )}

      {pool?.low && pool.replayCases.length > 0 && (
        <Card className="border-partial-edge bg-partial-tint px-4 py-3" role="note" data-testid="pool-low">
          <p className="font-bold text-partial">
            {pool.untouched === 0 ? "Every live dispute has been handled." : `Only ${pool.untouched} live ${pool.untouched === 1 ? "dispute still needs" : "disputes still need"} a response.`}
          </p>
          <p className="text-[14px] text-partial">
            Each sandbox dispute can only be filed once, so this pool gets used up. These cases were recorded from the real sandbox and can be played again in Replay, clearly marked as recordings:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pool.replayCases.map((c) => (
              <button
                key={c.disputeId}
                type="button"
                className="min-h-10 rounded-lg border border-partial-edge bg-surface px-3 text-[13.5px] font-semibold text-partial hover:bg-white"
                onClick={() => {
                  setMode("replay");
                  router.push(`/cases/${c.disputeId}`);
                }}
                data-testid="pool-replay-case"
              >
                Replay: {c.label}
              </button>
            ))}
          </div>
        </Card>
      )}

      {board && (
        <SchedulerBoard
          cases={board.cases}
          blocks={board.blocks}
          unscheduled={board.unscheduled}
          team={board.team}
          timezone={board.timezone}
          justBooked={justBooked}
          handlers={{ onMove, onUnschedule, onOpen, onSelect: setSelected }}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted" aria-label="Legend">
        <span className="font-semibold text-ink">Blocks:</span>
        <LegendDot className="border-l-ready-edge bg-ready-tint" label="Evidence ready" />
        <LegendDot className="border-l-partial-edge bg-partial-tint" label="Partial" />
        <LegendDot className="border-l-missing-edge bg-missing-tint" label="Missing" />
        <LegendDot className="border-l-slate bg-slate-tint" label="Not assessed yet" />
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 border-l-[3px] border-missing-edge" aria-hidden="true" /> PayPal deadline</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 border-l-[3px] border-dashed border-partial-edge" aria-hidden="true" /> Desk target</span>
        <span>Drag to reassign, drag an edge to change effort, double-click to edit, right-click for more. Times are {board?.timezone.replace(/_/g, " ") ?? "store time"}.</span>
      </div>

      {selectedCase && (
        <Card className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="selected-case">
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {selectedCase.customer ?? "Customer"} · {money(selectedCase.amount)} · {reasonLabel(selectedCase.reason)}
            </p>
            <p className="text-sm text-muted">
              {selectedCase.product} · {stageLabel(selectedCase.stage)} · {dueText(selectedCase.dueAt).text}
              {selectedCase.readiness ? ` · ${READINESS_LABEL[selectedCase.readiness]}` : ""}
            </p>
          </div>
          <Link href={`/cases/${selectedCase.disputeId}`} className="inline-flex min-h-11 items-center rounded-lg bg-forest px-4 font-semibold text-white hover:bg-forest-deep" data-testid="open-selected">
            Open case file
          </Link>
        </Card>
      )}

      {board && board.cases.length === 0 && !busy && !error && (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="empty-board">
          <Marlow mood="empty" size={120} />
          <h2 className="text-lg font-bold">No disputes right now</h2>
          <p className="max-w-md text-muted">Marlow keeps calm when a chargeback lands. New disputes arrive here from PayPal within a few minutes of being opened.</p>
        </Card>
      )}

      {board && needs > 0 && (
        <section aria-labelledby="needs-title">
          <h2 id="needs-title" className="mb-2 text-[17px] font-bold">Needs a response ({needs})</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {board.cases.filter((c) => c.needsSeller).map((c) => <CaseCard key={c.disputeId} c={c} tz={board.timezone} />)}
          </ul>
        </section>
      )}

      {board && board.waiting.length > 0 && (
        <section aria-labelledby="waiting-title">
          <h2 id="waiting-title" className="mb-2 text-[17px] font-bold">With PayPal or the buyer ({board.waiting.length})</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {board.waiting.map((id) => caseById(id)).filter(Boolean).map((c) => <CaseCard key={c!.disputeId} c={c!} tz={board.timezone} />)}
          </ul>
        </section>
      )}

      {board && board.resolved.length > 0 && (
        <section aria-labelledby="resolved-title">
          <h2 id="resolved-title" className="mb-2 text-[17px] font-bold">Resolved ({board.resolved.length})</h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {board.resolved.map((id) => caseById(id)).filter(Boolean).map((c) => <CaseCard key={c!.disputeId} c={c!} tz={board.timezone} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "missing" | "slate" | "ready" }) {
  return (
    <div>
      <p className={cx("text-2xl font-extrabold", tone === "missing" ? "text-missing" : tone === "ready" ? "text-ready" : "text-slate")}>{value}</p>
      <p className="text-[12px] font-semibold text-muted">{label}</p>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("inline-block h-4 w-6 rounded border border-[rgb(0_0_0/0.12)] border-l-4", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

export function CaseCard({ c, tz }: { c: CaseMeta; tz: string }) {
  const due = dueText(c.dueAt);
  const outcome = c.outcome ? OUTCOME_TEXT(c.outcome.code, c.outcome.wonAmount, c.amount) : null;
  return (
    <li>
      <Link
        href={`/cases/${c.disputeId}`}
        className="block h-full rounded-[14px] border border-line bg-surface px-4 py-3 hover:border-forest hover:shadow-md"
        data-testid={`case-card-${c.disputeId}`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-bold">
            <span className="block truncate">{c.customer ?? "Customer"}</span>
            <span className="block truncate text-[13px] font-medium text-muted">{c.product}</span>
          </p>
          <p className="text-lg font-extrabold">{money(c.amount)}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tone="slate">{reasonLabel(c.reason)}</Chip>
          <Chip>{stageLabel(c.stage)}</Chip>
          {outcome ? (
            <Chip tone={outcome.tone}>{outcome.title}</Chip>
          ) : (
            <>
              {c.readiness && <Chip tone={c.readiness}>{READINESS_LABEL[c.readiness]}</Chip>}
              {c.recommendation && <Chip tone="forest">Marlow: {c.recommendation}</Chip>}
            </>
          )}
          {c.replay && <Chip tone="partial">Replay</Chip>}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          {outcome ? `Resolved ${fmtDate(c.outcome?.resolvedAt, tz)}` : c.needsSeller ? (
            <span className={due.urgent ? "font-semibold text-missing" : ""}>
              {c.dueKind === "target" ? "Desk target" : "PayPal deadline"}: {fmtDate(c.dueAt, tz)} ({due.text.toLowerCase()})
            </span>
          ) : statusLabel(c.status)}
        </p>
      </Link>
    </li>
  );
}
