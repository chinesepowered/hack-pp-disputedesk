"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Marlow } from "@/components/marlow/Marlow";
import { Card, Chip, cx, dueText, fmtDate, money, OUTCOME_TEXT, READINESS_LABEL, reasonLabel, stageLabel, statusLabel } from "@/components/ui/atoms";
import { api, ApiError } from "@/lib/client/store";
import type { BoardView } from "@/lib/desk/board";

type Filter = "all" | "needs" | "waiting" | "resolved";

export default function CasesPage() {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api<{ board: BoardView }>("/api/board")
      .then((r) => setBoard(r.board))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the cases."));
  }, []);

  const rows = useMemo(() => {
    if (!board) return [];
    return board.cases.filter((c) => (filter === "all" ? true : filter === "needs" ? c.needsSeller : filter === "resolved" ? Boolean(c.outcome) : !c.needsSeller && !c.outcome));
  }, [board, filter]);

  const counts = {
    all: board?.cases.length ?? 0,
    needs: board?.cases.filter((c) => c.needsSeller).length ?? 0,
    waiting: board?.waiting.length ?? 0,
    resolved: board?.resolved.length ?? 0,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">All cases</h1>
          <p className="text-[14px] text-muted">Every dispute PayPal has for this account, read live from the Disputes API.</p>
        </div>
        <div role="group" aria-label="Filter cases" className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All"],
              ["needs", "Need you"],
              ["waiting", "With PayPal or buyer"],
              ["resolved", "Resolved"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cx("min-h-10 rounded-lg border px-3 text-[13.5px] font-semibold", filter === key ? "border-forest bg-forest text-white" : "border-line bg-surface hover:bg-sunken")} data-testid={`filter-${key}`}>
              {label} ({counts[key]})
            </button>
          ))}
        </div>
      </div>

      {error && <Card className="border-missing-edge bg-missing-tint px-4 py-3 text-missing" role="alert">{error}</Card>}
      {!board && !error && <p className="py-10 text-center text-muted" role="status">Reading disputes from PayPal…</p>}

      {board && rows.length === 0 && (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Marlow mood="empty" size={100} />
          <p className="font-bold">Nothing here</p>
          <p className="text-muted">No cases match this filter.</p>
        </Card>
      )}

      {board && rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[14px]" data-testid="cases-table">
            <caption className="sr-only">Disputes</caption>
            <thead className="bg-paper text-left text-[12.5px] uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Customer and item</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Amount</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Reason</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">PayPal status</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Evidence</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Marlow says</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Deadline or outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const outcome = c.outcome ? OUTCOME_TEXT(c.outcome.code, c.outcome.wonAmount, c.amount) : null;
                const due = dueText(c.dueAt);
                return (
                  <tr key={c.disputeId} className="border-t border-line hover:bg-paper">
                    <th scope="row" className="px-4 py-2.5 text-left">
                      <Link href={`/cases/${c.disputeId}`} className="font-bold text-forest-deep underline-offset-2 hover:underline" data-testid={`case-link-${c.disputeId}`}>{c.customer ?? "Customer"}</Link>
                      <span className="block text-[12.5px] font-normal text-muted">{c.product} · {c.disputeId}</span>
                    </th>
                    <td className="px-3 py-2.5 font-bold">{money(c.amount)}</td>
                    <td className="px-3 py-2.5">{reasonLabel(c.reason)}</td>
                    <td className="px-3 py-2.5">{stageLabel(c.stage)} · {statusLabel(c.status)}{c.replay ? " (replay)" : ""}</td>
                    <td className="px-3 py-2.5">{c.readiness ? <Chip tone={c.readiness}>{READINESS_LABEL[c.readiness].replace("Evidence ", "")}</Chip> : <span className="text-muted">not read yet</span>}</td>
                    <td className="px-3 py-2.5">{c.recommendation ? `${c.recommendation}${c.likelihood !== null ? `, ${c.likelihood}%` : ""}` : ""}</td>
                    <td className="px-4 py-2.5">
                      {outcome ? <Chip tone={outcome.tone}>{outcome.title}</Chip> : c.needsSeller ? <span className={due.urgent ? "font-semibold text-missing" : ""}>{fmtDate(c.dueAt, board.timezone)} ({due.text.toLowerCase()})</span> : <span className="text-muted">waiting</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
