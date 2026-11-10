/**
 * Prevention: patterns across cases. The counting is deterministic; the AI only phrases the
 * card. Each card names the cases behind it so the merchant can check the claim.
 */
import { phrasePattern } from "@/lib/ai/tasks";
import { getDoc, setDoc } from "@/lib/store";
import { currentMode } from "@/lib/paypal/log";
import { loadCase, loadDesk } from "./state";
import type { AiTag, CaseDetail } from "./types";

export type PreventionCard = {
  id: string;
  kind: "product" | "carrier" | "fraud" | "untracked";
  title: string;
  facts: string[];
  fix: string;
  cases: { disputeId: string; label: string }[];
  amount: number;
  blurb: { text: string; ai: AiTag | null };
};

type Row = { detail: CaseDetail; amount: number; label: string };

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

export function detectPatterns(rows: Row[]): Omit<PreventionCard, "blurb">[] {
  const cards: Omit<PreventionCard, "blurb">[] = [];
  const total = rows.length;

  // One product drawing "not as described".
  const byProduct = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.detail.dispute.reason !== "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED") continue;
    const name = r.detail.evidence?.store.product?.name ?? r.detail.evidence?.paypal.items[0]?.name;
    if (!name) continue;
    byProduct.set(name, [...(byProduct.get(name) ?? []), r]);
  }
  for (const [name, list] of byProduct) {
    if (list.length < 2) continue;
    const product = list[0].detail.evidence?.store.product;
    const sum = list.reduce((s, r) => s + r.amount, 0);
    cards.push({
      id: `product-${name}`,
      kind: "product",
      title: `${name} keeps drawing "not as described"`,
      facts: [
        `${list.length} of ${total} disputes are "not as described" claims on this one product`,
        `$${sum.toFixed(0)} at stake across them`,
        product?.sizeChart === false ? "its product page has no size chart or measurements" : "its product page lists measurements",
        `the product page says: ${(product?.pageFacts ?? []).join("; ") || "nothing specific"}`,
      ],
      fix: product?.sizeChart === false ? "Add a size chart with measurements and two or three more photos, including one with something for scale." : "Add photos that show colour and size next to a common object.",
      cases: list.map((r) => ({ disputeId: r.detail.disputeId, label: r.label })),
      amount: sum,
    });
  }

  // One carrier drawing "not received".
  const byCarrier = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.detail.dispute.reason !== "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") continue;
    const carrier = r.detail.evidence?.store.carrier;
    if (!carrier || carrier.outcome === "untracked") continue;
    byCarrier.set(carrier.name, [...(byCarrier.get(carrier.name) ?? []), r]);
  }
  for (const [name, list] of byCarrier) {
    if (list.length < 2) continue;
    const unsigned = list.filter((r) => !r.detail.evidence?.store.carrier?.signature);
    if (unsigned.length < 2) continue;
    const sum = list.reduce((s, r) => s + r.amount, 0);
    const threshold = Math.max(20, Math.round(median(unsigned.map((r) => r.amount)) / 5) * 5);
    cards.push({
      id: `carrier-${name}`,
      kind: "carrier",
      title: `${name} deliveries keep being reported as not received`,
      facts: [
        `${list.length} of ${total} disputes are "not received" claims on ${name} parcels`,
        `${unsigned.length} of those ${list.length} had no signature on delivery`,
        `$${sum.toFixed(0)} at stake across them`,
      ],
      fix: `Require a signature on ${name} orders over $${threshold}, or move those orders to a service that takes a delivery photo.`,
      cases: list.map((r) => ({ disputeId: r.detail.disputeId, label: r.label })),
      amount: sum,
    });
  }

  // Unauthorized claims with mismatched details.
  const unauthorized = rows.filter((r) => r.detail.dispute.reason === "UNAUTHORISED");
  const mismatched = unauthorized.filter((r) => r.detail.evidence?.store.risk && (!r.detail.evidence.store.risk.billingMatchesShipTo || !r.detail.evidence.store.risk.ipMatchesShipTo));
  if (unauthorized.length >= 1 && mismatched.length >= 1) {
    const sum = unauthorized.reduce((s, r) => s + r.amount, 0);
    const regions = [...new Set(mismatched.map((r) => r.detail.evidence?.store.risk?.ipRegion).filter(Boolean))];
    cards.push({
      id: "fraud-mismatch",
      kind: "fraud",
      title: "Unauthorized claims on orders with mismatched addresses",
      facts: [
        `${unauthorized.length} of ${total} disputes are unauthorized payment claims`,
        `${mismatched.length} of those shipped to an address that did not match the billing details`,
        `the mismatched orders came from ${regions.join(", ") || "one region"} and were first orders from new customers`,
        `$${sum.toFixed(0)} at stake across them`,
      ],
      fix: "Hold first orders where billing and shipping do not match until the customer confirms by email, before shipping.",
      cases: unauthorized.map((r) => ({ disputeId: r.detail.disputeId, label: r.label })),
      amount: sum,
    });
  }

  // Untracked shipments cannot be defended.
  const untracked = rows.filter((r) => r.detail.dispute.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && r.detail.evidence?.store.carrier?.outcome === "untracked");
  if (untracked.length >= 1) {
    const sum = untracked.reduce((s, r) => s + r.amount, 0);
    cards.push({
      id: "untracked",
      kind: "untracked",
      title: "Untracked post cannot be defended",
      facts: [
        `${untracked.length} "not received" ${untracked.length === 1 ? "claim is" : "claims are"} on orders sent by untracked letter post`,
        "with no tracking number there is nothing to file, so these are refunded every time",
        `$${sum.toFixed(0)} at stake`,
      ],
      fix: "Offer tracked post as the default and show untracked as an at-your-own-risk option, or absorb the loss knowingly on items under $15.",
      cases: untracked.map((r) => ({ disputeId: r.detail.disputeId, label: r.label })),
      amount: sum,
    });
  }

  return cards.sort((a, b) => b.amount - a.amount);
}

export async function preventionCards(): Promise<{ cards: PreventionCard[]; assessed: number; total: number }> {
  const desk = await loadDesk();
  const metas = Object.values(desk.cases);
  const rows: Row[] = [];
  for (const m of metas) {
    const detail = await loadCase(m.disputeId);
    if (detail?.evidence) rows.push({ detail, amount: m.amount, label: `${m.customer ?? "Customer"}, $${m.amount.toFixed(0)}` });
  }
  const found = detectPatterns(rows);
  const cacheKey = currentMode() === "replay" ? null : "pattern-blurbs";
  const cache = cacheKey ? ((await getDoc<Record<string, PreventionCard["blurb"]>>(cacheKey)) ?? {}) : {};
  let changed = false;
  const cards: PreventionCard[] = [];
  for (const card of found) {
    const signature = `${card.id}|${card.facts.join("|")}`;
    let blurb = cache[signature];
    if (!blurb) {
      try {
        const res = await phrasePattern({ title: card.title, facts: card.facts, fix: card.fix });
        blurb = { text: res.text, ai: res.ai };
        cache[signature] = blurb;
        changed = true;
      } catch {
        blurb = { text: `${card.facts[0]}. ${card.fix}`, ai: null };
      }
    }
    cards.push({ ...card, blurb });
  }
  if (changed && cacheKey) await setDoc(cacheKey, cache);
  return { cards, assessed: rows.length, total: metas.length };
}
