/**
 * What the AI does on this desk: read photos, explain the rule-based recommendation, write the
 * response, summarize patterns. It never decides money: every prompt is handed the decision the
 * rules already made and asked to explain or write around it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AiTag, ChecklistItem, EvidenceBundle, PhotoRead, Recommendation } from "@/lib/desk/types";
import type { Dispute } from "@/lib/paypal/types";
import { reasonTitle } from "@/lib/rules/evidence-table";
import { STORE } from "@/lib/shop/catalog";
import { extractJson, generate } from "./client";

const VOICE =
  "You are Marlow, a calm, precise clerk who handles payment disputes for a small online shop. " +
  "Write plainly and briefly. Never use em dashes. Never invent facts: use only what you are given.";

export const PHOTO_QUESTIONS = {
  delivery: "Does this carrier delivery photo show a parcel left at a door or on a doorstep?",
  damage: "Does this customer photo show a damaged, broken or dying item?",
} as const;

/** Vision: answer one yes/no question about one photo. */
export async function readPhoto(photo: string, kind: keyof typeof PHOTO_QUESTIONS): Promise<PhotoRead> {
  const question = PHOTO_QUESTIONS[kind];
  const file = path.join(process.cwd(), "public", photo.replace(/^\//, ""));
  const image = await fs.readFile(file);
  const res = await generate({
    kind: "vision",
    vision: true,
    replayKey: `photo:${kind}:${photo}`,
    maxTokens: 200,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${question}\nLook carefully and answer only with JSON: {"verdict":"yes" | "no" | "unclear","summary":"one plain sentence describing what the photo shows"}`,
          },
          { type: "image", image, mimeType: "image/jpeg" },
        ],
      },
    ],
  });
  const parsed = extractJson<{ verdict?: string; summary?: string }>(res.text);
  const verdict = parsed?.verdict === "yes" || parsed?.verdict === "no" ? parsed.verdict : "unclear";
  const summary = (parsed?.summary ?? res.text).replace(/\s+/g, " ").trim().slice(0, 220);
  return { photo, question, verdict, summary, ai: res.ai };
}

const storeTime = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: STORE.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

function caseFacts(dispute: Dispute, bundle: EvidenceBundle, checklist: ChecklistItem[]): string {
  const lines = [
    `Dispute ${dispute.dispute_id}: ${reasonTitle(dispute.reason)}, ${dispute.dispute_amount.value} ${dispute.dispute_amount.currency_code}, stage ${dispute.dispute_life_cycle_stage ?? "unknown"}, status ${dispute.status}.`,
    `Buyer's words: "${dispute.messages?.[0]?.content ?? dispute.evidences?.[0]?.notes ?? "(none)"}"`,
    `Order: ${bundle.paypal.items.map((i) => `${i.quantity} x ${i.name}`).join(", ") || bundle.store.product?.name || "unknown item"}, invoice ${bundle.paypal.invoiceId ?? "unknown"}.`,
    `Ship to: ${bundle.paypal.shipTo ? `${bundle.paypal.shipTo.name}, ${bundle.paypal.shipTo.line1}, ${bundle.paypal.shipTo.city} ${bundle.paypal.shipTo.state}` : "unknown"}.`,
    "Evidence checklist:",
    ...checklist.map((c) => `- [${c.status}] ${c.label}: ${c.detail} (${c.source})`),
  ];
  if (bundle.store.carrier?.scans.length) {
    lines.push("Carrier scans (store time):", ...bundle.store.carrier.scans.map((s) => `- ${storeTime(s.at)}: ${s.status}, ${s.location}`));
  }
  if (bundle.store.thread.length) {
    lines.push("Messages:", ...bundle.store.thread.map((m) => `- ${m.from}: ${m.text}`));
  }
  if (bundle.store.returnPolicy.length) lines.push("Return policy:", ...bundle.store.returnPolicy.map((p) => `- ${p}`));
  return lines.join("\n");
}

/** Explain, in plain English, the recommendation the rules produced. */
export async function explainRecommendation(
  dispute: Dispute,
  bundle: EvidenceBundle,
  checklist: ChecklistItem[],
  rec: Recommendation,
): Promise<{ text: string; ai: AiTag }> {
  const decision =
    rec.action === "fight"
      ? `FIGHT: respond with evidence. Win estimate ${rec.likelihood}%.`
      : rec.action === "offer"
        ? `OFFER a partial refund of $${rec.offerAmount}. Win estimate ${rec.likelihood}%.`
        : `ACCEPT the claim and refund the buyer. Win estimate ${rec.likelihood}%.`;
  const res = await generate({
    kind: "text",
    replayKey: `explain:${dispute.dispute_id}`,
    system: VOICE,
    maxTokens: 260,
    messages: [
      {
        role: "user",
        content:
          `The shop's rules have already decided this case. Decision: ${decision}\n` +
          `Economics: $${rec.economics.amount} at stake, about ${rec.economics.staffMinutes} minutes of staff time ($${rec.economics.staffCost}), dispute fee $${rec.economics.fee} if a claim is lost.\n\n` +
          `${caseFacts(dispute, bundle, checklist)}\n\n` +
          "Explain the decision to the shop owner in 3 or 4 short sentences. Cite the specific evidence that drives it (name the carrier, the signature, the photo, the missing item). " +
          "Do not change the decision or the numbers. No headings, no lists.",
      },
    ],
  });
  return { text: res.text, ai: res.ai };
}

/** Write the seller's response for PayPal: a short cover letter that cites the evidence pack. */
export async function draftResponse(
  dispute: Dispute,
  bundle: EvidenceBundle,
  checklist: ChecklistItem[],
  rec: Recommendation,
): Promise<{ text: string; ai: AiTag }> {
  const goal =
    rec.action === "fight"
      ? "ask PayPal to find in the seller's favour, citing each piece of evidence in the pack"
      : rec.action === "offer"
        ? `offer the buyer a partial refund of $${rec.offerAmount} to settle, politely, and say what the listing stated`
        : "accept the claim politely and confirm the refund";
  const res = await generate({
    kind: "text",
    replayKey: `draft:${dispute.dispute_id}`,
    system: VOICE,
    maxTokens: 420,
    messages: [
      {
        role: "user",
        content:
          `Write the seller's response for PayPal case ${dispute.dispute_id} on behalf of ${STORE.name}. Goal: ${goal}.\n\n` +
          `${caseFacts(dispute, bundle, checklist)}\n\n` +
          "Rules: 90 to 150 words. Plain text, no markdown, no greeting line beyond 'Hello,'. State dates and tracking numbers exactly as given. " +
          "Only mention evidence marked present. Do not mention evidence marked missing or against. End with 'Thank you, Juniper & Moss'.",
      },
    ],
  });
  return { text: res.text, ai: res.ai };
}

/** A short spoken-style note from Marlow about what it just did. */
export async function explainSchedule(lines: string[]): Promise<{ text: string; ai: AiTag }> {
  const res = await generate({
    kind: "text",
    replayKey: "schedule:explain",
    system: VOICE,
    maxTokens: 160,
    messages: [
      {
        role: "user",
        content:
          "You just booked dispute work on the team's board using the shop's scheduling rules. Here is exactly what was booked:\n" +
          lines.map((l) => `- ${l}`).join("\n") +
          "\n\nSummarize it for the team in 2 short sentences, in the first person. Mention the most urgent booking by name and time. Do not add anything that is not in the list.",
      },
    ],
  });
  return { text: res.text, ai: res.ai };
}

/** Phrase one prevention card. The pattern and the numbers come from deterministic counting. */
export async function phrasePattern(pattern: { title: string; facts: string[]; fix: string }): Promise<{ text: string; ai: AiTag }> {
  const res = await generate({
    kind: "text",
    replayKey: `pattern:${pattern.title}`,
    system: VOICE,
    maxTokens: 140,
    messages: [
      {
        role: "user",
        content:
          `A pattern was found across this shop's disputes: ${pattern.title}\nFacts:\n${pattern.facts.map((f) => `- ${f}`).join("\n")}\nSuggested fix: ${pattern.fix}\n\n` +
          "Write 2 sentences for the shop owner: what the pattern is (with the numbers) and why the fix should help. Do not add numbers that are not in the facts.",
      },
    ],
  });
  return { text: res.text, ai: res.ai };
}
