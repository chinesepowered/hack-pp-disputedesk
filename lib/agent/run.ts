/**
 * The agent loop: Marlow gets an instruction about one dispute and works it with tools.
 * Every tool call lands in the case's reasoning trail. Money stays deterministic: the tools
 * enforce the rules in code (lib/agent/tools.ts), whatever the model asks for.
 */
import { generateText } from "ai";
import { model, tidy } from "@/lib/ai/client";
import { addTrail, loadCase, loadDesk, loadSettings, saveCase } from "@/lib/desk/state";
import { prepareCase } from "@/lib/desk/sync";
import type { AiTag, CaseDetail, CaseMeta } from "@/lib/desk/types";
import { env } from "@/lib/env";
import { currentMode } from "@/lib/paypal/log";
import { formatInZone } from "@/lib/schedule/time";
import { buildTools, type ToolEvent } from "./tools";

export type AgentResult = { answer: string; ai: AiTag | null; events: ToolEvent[]; detail: CaseDetail; meta: CaseMeta; usedFallback: boolean };

const SYSTEM = `You are Marlow, a calm, precise clerk who handles payment disputes for Juniper & Moss, a small online plant shop.
You work one PayPal dispute at a time using tools.

How you work:
- First call get_dispute to read the dispute's current status, stage and links from PayPal. Then call gather_evidence, unless the merchant only asked a scheduling question. It returns the evidence checklist and rule_decision.
- The rule_decision (fight, offer or accept, the win estimate and the offer amount) is decided by the shop's fixed rules. Follow it. Never invent amounts or evidence. If the merchant gives a specific amount or instruction, use theirs.
- To act on a decision: fight means provide_evidence with the draft_response as notes; offer means make_offer with rule_decision.offer_amount and a short friendly note; accept means accept_dispute_claim.
- You cannot file anything by yourself. provide_evidence, make_offer and send_message record a proposal that a person approves. accept_dispute_claim only goes through when the merchant's auto-accept rule allows it; otherwise it becomes a proposal too.
- A tool may answer "Refused in code". That is final for that action: say so plainly and do not retry it.
- Use schedule_work_block when asked to book or move time. Team member ids: sam, jo, dee.

When you are done, answer the merchant in at most 70 words: what you found, what you proposed or did, and what needs their approval. Plain sentences. Never use em dashes.`;

/** The same steps without a model: used in Replay and when the model is unavailable. */
async function scripted(disputeId: string, events: ToolEvent[]): Promise<string> {
  const { detail } = await prepareCase(disputeId, { explain: false, draft: true });
  const rec = detail.recommendation;
  events.push({ tool: "gather_evidence", ok: true, summary: `Case built: ${rec?.action ?? "no decision"} at ${rec?.likelihood ?? "?"}% win estimate.` });
  if (!rec) return "I built the case but the rules produced no recommendation.";
  const what = rec.action === "fight" ? "file the response with the evidence pack" : rec.action === "offer" ? `offer the buyer $${rec.offerAmount}` : "accept the claim";
  return `I built the case from PayPal and the store's records. The rules say ${rec.action} at a ${rec.likelihood}% win estimate, so the next step is to ${what}. ${rec.approvalReason}`;
}

export async function runAgent(input: { disputeId: string; instruction: string }): Promise<AgentResult> {
  const { disputeId } = input;
  const instruction = input.instruction.trim().slice(0, 600) || "Work this case.";
  const settings = await loadSettings();
  const events: ToolEvent[] = [];
  let answer = "";
  let ai: AiTag | null = null;
  let usedFallback = false;

  const before = await loadCase(disputeId);
  if (before) {
    addTrail(before, { actor: "person", kind: "note", title: "Asked Marlow", detail: instruction });
    await saveCase(before);
  }

  if (currentMode() === "replay") {
    const { replayAi } = await import("@/lib/replay/engine");
    const text = await scripted(disputeId, events);
    try {
      const recorded = await replayAi(`agent:${disputeId}`, "agent");
      answer = recorded.text;
      ai = recorded.ai;
    } catch {
      answer = text;
    }
  } else {
    const now = new Date();
    const context =
      `Dispute id: ${disputeId}\n` +
      `Now: ${formatInZone(now, settings.timezone, { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} store time (${now.toISOString()}).\n` +
      `Team: ${settings.team.filter((p) => !p.isAgent).map((p) => `${p.id} (${p.name}, ${p.role}, ${p.start}:00 to ${p.end}:00)`).join("; ")}.\n` +
      `Merchant rules: auto-accept ${settings.autoAcceptEnabled ? `under $${settings.autoAcceptUnder} when evidence is weak` : "is off"}; always ask above $${settings.alwaysAskAbove}.\n\n` +
      `Merchant's instruction: ${instruction}`;

    const attempt = async (id: string, fallback: boolean) => {
      const tag: AiTag = { model: id, kind: "agent", ...(fallback ? { fallback: true } : {}) };
      const res = await generateText({
        model: model(id),
        system: SYSTEM,
        prompt: context,
        tools: buildTools(tag, events),
        maxSteps: 7,
        maxTokens: 2600,
        temperature: 0.1,
        maxRetries: 4,
        abortSignal: AbortSignal.timeout(100_000),
      });
      const text = tidy(res.text ?? "");
      if (!text && !events.length) throw new Error("The model returned nothing.");
      return { text, tag };
    };

    try {
      const out = await attempt(env.aiModel, false);
      answer = out.text;
      ai = out.tag;
    } catch {
      try {
        events.length = 0;
        const out = await attempt(env.aiFallbackModel, true);
        answer = out.text;
        ai = out.tag;
      } catch {
        // Neither model answered: do the standard steps in code and say so.
        usedFallback = true;
        events.length = 0;
        answer = `${await scripted(disputeId, events)} (The model did not answer, so I followed the standard steps.)`;
      }
    }
    if (!answer) answer = events.length ? events[events.length - 1].summary : "Done.";
  }

  const detail = (await loadCase(disputeId)) as CaseDetail;
  for (const e of events) {
    // Proposals already add their own trail entry inside the tool.
    if (/Proposal recorded|proposal is waiting/i.test(e.summary)) continue;
    addTrail(detail, { actor: "marlow", kind: "tool", title: `Tool: ${e.tool}`, detail: e.summary, ok: e.ok, ai: ai ?? undefined });
  }
  addTrail(detail, { actor: "marlow", kind: "ai", title: "Marlow's answer", detail: answer, ai: ai ?? undefined });
  await saveCase(detail);
  const desk = await loadDesk();
  return { answer, ai, events, detail, meta: desk.cases[disputeId], usedFallback };
}
