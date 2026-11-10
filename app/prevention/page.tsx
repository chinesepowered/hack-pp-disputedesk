"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Marlow } from "@/components/marlow/Marlow";
import { AiTag, Card, Chip, money } from "@/components/ui/atoms";
import { api, ApiError } from "@/lib/client/store";
import type { PreventionCard } from "@/lib/desk/patterns";

const KIND = { product: "Product page", carrier: "Shipping", fraud: "Fraud check", untracked: "Shipping" } as const;

export default function PreventionPage() {
  const [data, setData] = useState<{ cards: PreventionCard[]; assessed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ cards: PreventionCard[]; assessed: number; total: number }>("/api/prevention")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the patterns."));
  }, []);

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4">
      <Card className="flex items-center gap-4 px-5 py-4">
        <Marlow mood={data ? "calm" : "working"} size={76} />
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Prevention</h1>
          <p className="text-[14.5px] text-muted">
            Winning a dispute is good. Not getting it is better. Marlow looks for the same cause showing up across cases and suggests one fix for each.
          </p>
          {data && <p className="mt-1 text-[13px] text-muted">Based on {data.assessed} of {data.total} disputes Marlow has read. The counts come from the cases; the model only writes the summary.</p>}
        </div>
      </Card>

      {error && <Card className="border-missing-edge bg-missing-tint px-4 py-3 text-missing" role="alert">{error}</Card>}
      {!data && !error && <p className="py-8 text-center text-muted" role="status">Marlow is looking across the cases…</p>}

      {data && data.cards.length === 0 && (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="prevention-empty">
          <Marlow mood="empty" size={110} />
          <h2 className="text-lg font-bold">No patterns yet</h2>
          <p className="max-w-md text-muted">A pattern needs at least two cases with the same cause. Open the board so Marlow can read the disputes first.</p>
        </Card>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {data?.cards.map((card) => (
          <li key={card.id}>
            <Card as="article" className="flex h-full flex-col px-5 py-4" data-testid="prevention-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chip tone="slate">{KIND[card.kind]}</Chip>
                <span className="text-[13px] font-semibold text-missing">{money(card.amount)} at stake</span>
              </div>
              <h2 className="mt-2 text-[18px] font-bold leading-snug">{card.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed">{card.blurb.text}</p>
              <AiTag ai={card.blurb.ai} className="mt-1.5 self-start" />
              <div className="mt-3 rounded-xl bg-forest-tint px-3 py-2.5">
                <p className="text-[12.5px] font-bold uppercase tracking-wide text-forest-deep">Suggested fix</p>
                <p className="text-[14.5px] font-semibold">{card.fix}</p>
              </div>
              <details className="mt-3 text-[13.5px]">
                <summary className="cursor-pointer font-semibold text-forest-deep">The numbers behind this ({card.cases.length} cases)</summary>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted">
                  {card.facts.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {card.cases.map((c) => (
                    <Link key={c.disputeId} href={`/cases/${c.disputeId}`} className="rounded-full border border-line px-2.5 py-0.5 font-semibold hover:bg-sunken">{c.label}</Link>
                  ))}
                </p>
              </details>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
