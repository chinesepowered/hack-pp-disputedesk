/**
 * Marlow's tools.
 *
 * From @paypal/agent-toolkit, used as they come: list_disputes and get_dispute.
 * Written here: accept_dispute_claim (the toolkit's tool of that name moves money, so the agent
 * gets a guarded one instead), gather_evidence, provide_evidence, make_offer, send_message and
 * schedule_work_block.
 *
 * The rule for every tool that can move money or speak for the merchant: the model may ask for
 * anything, but the tool checks the request in code (the dispute's links, PayPal's allowed
 * amounts and types, the merchant's thresholds) before anything happens, and what it produces is
 * a proposal a person approves. The one exception is the merchant's own auto-accept rule.
 */
import { randomUUID } from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { autoSchedule, moveBlock } from "@/lib/desk/board";
import { DeskError, fileAction } from "@/lib/desk/filing";
import { addTrail, loadCase, loadDesk, loadSettings, saveCase } from "@/lib/desk/state";
import { prepareCase, refreshCase } from "@/lib/desk/sync";
import type { AiTag, Proposal } from "@/lib/desk/types";
import { env } from "@/lib/env";
import { getDispute } from "@/lib/paypal/disputes";
import { currentMode, withFeature } from "@/lib/paypal/log";
import { installToolkitLogging } from "@/lib/paypal/toolkit-log";
import type { DisputeAction } from "@/lib/paypal/types";
import { strengthOf } from "@/lib/rules/assess";
import { checkAllowedByPayPal, checkOfferAmount, mayAutoFile } from "@/lib/rules/guards";
import { slotLabel, zonedParts } from "@/lib/schedule/time";

let toolkit: PayPalAgentToolkit | null = null;

function paypalToolkit(): PayPalAgentToolkit {
  if (!toolkit) {
    installToolkitLogging();
    toolkit = new PayPalAgentToolkit({
      clientId: env.paypalClientId,
      clientSecret: env.paypalClientSecret,
      configuration: {
        // In toolkit 1.11 the disputes "create" flag is what enables accept_dispute_claim.
        actions: { disputes: { list: true, get: true, create: true } },
        context: { sandbox: true },
      },
    });
  }
  return toolkit;
}

export type ToolEvent = { tool: string; ok: boolean; summary: string };

async function propose(disputeId: string, p: Omit<Proposal, "id" | "createdAt" | "status">): Promise<Proposal> {
  const detail = await loadCase(disputeId);
  if (!detail) throw new DeskError(404, "UNKNOWN_CASE", "No case file for this dispute yet.");
  const proposal: Proposal = { id: randomUUID(), createdAt: new Date().toISOString(), status: "pending", ...p };
  // One pending proposal per action: a newer one replaces the older.
  detail.proposals = [...(detail.proposals ?? []).filter((x) => !(x.status === "pending" && x.action === p.action)), proposal];
  addTrail(detail, { actor: "marlow", kind: "tool", title: `Proposed: ${p.action.replace(/_/g, " ")}`, detail: `${p.why} Waiting for your approval.`, ai: p.ai ?? undefined });
  await saveCase(detail);
  return proposal;
}

/** Shared pre-flight for the filing tools: a fresh read of the dispute and the links check. */
async function preflight(disputeId: string, action: DisputeAction) {
  const dispute = await getDispute(disputeId, `Agent tool: check ${action.replace(/_/g, " ")} is allowed`);
  const allowed = checkAllowedByPayPal(dispute, action);
  return { dispute, allowed };
}

export function buildTools(ai: AiTag, events: ToolEvent[]): Record<string, Tool> {
  const note = (toolName: string, ok: boolean, summary: string) => {
    events.push({ tool: toolName, ok, summary });
    return summary;
  };
  const replay = currentMode() === "replay";
  const fromToolkit = replay ? {} : paypalToolkit().getTools();

  const wrapRead = (name: "list_disputes" | "get_dispute", feature: string): Tool => {
    const base = fromToolkit[name] as Tool | undefined;
    return tool({
      description: base?.description ?? name,
      parameters: (base?.parameters as z.ZodTypeAny) ?? z.object({ dispute_id: z.string().optional() }),
      execute: async (args: any, options: any) =>
        withFeature(feature, async () => {
          if (replay || !base?.execute) {
            // Replay has no toolkit: read through the app's own PayPal layer (recorded fixtures).
            if (name === "get_dispute") {
              const d = await getDispute(args.dispute_id, feature);
              note(name, true, `Read ${d.dispute_id}: ${d.status}, stage ${d.dispute_life_cycle_stage}.`);
              return JSON.stringify(d);
            }
            const desk = await loadDesk();
            note(name, true, `Listed ${Object.keys(desk.cases).length} disputes.`);
            return JSON.stringify(Object.values(desk.cases).map((c) => ({ dispute_id: c.disputeId, reason: c.reason, status: c.status, amount: c.amount })));
          }
          const out = await base.execute(args, options);
          const text = typeof out === "string" ? out : JSON.stringify(out);
          note(name, !/error/i.test(text.slice(0, 80)), name === "get_dispute" ? `Read dispute ${args.dispute_id} through the PayPal Agent Toolkit.` : "Listed disputes through the PayPal Agent Toolkit.");
          // Keep the model's context small: it only needs the gist.
          return text.length > 6000 ? `${text.slice(0, 6000)}... (truncated)` : text;
        }),
    });
  };

  return {
    list_disputes: wrapRead("list_disputes", "Agent tool: list_disputes (Agent Toolkit)"),
    get_dispute: wrapRead("get_dispute", "Agent tool: get_dispute (Agent Toolkit)"),

    /**
     * The toolkit's accept_dispute_claim moves money (PayPal refunds the buyer), so the agent
     * gets this guarded tool under the same name instead: links, then thresholds. If the
     * merchant's auto-accept rule covers the case it files through fileAction (the one path
     * every dispute write takes: claim, call, record); otherwise it becomes a proposal.
     */
    accept_dispute_claim: tool({
      description:
        "Accept liability for a dispute claim: PayPal refunds the buyer and closes the case. Only runs by itself when the merchant's auto-accept rule allows it; otherwise it records a proposal for a person to approve.",
      parameters: z.object({ dispute_id: z.string(), note: z.string().describe("Short note to PayPal explaining the acceptance") }),
      execute: async ({ dispute_id, note: text }) =>
        withFeature("Agent tool: accept_dispute_claim (guarded)", async () => {
          const { dispute, allowed } = await preflight(dispute_id, "accept_claim");
          if (!allowed.ok) return note("accept_dispute_claim", false, `Refused in code: ${allowed.reason}`);
          const [detail, settings] = await Promise.all([loadCase(dispute_id), loadSettings()]);
          const likelihood = detail?.recommendation?.likelihood;
          if (likelihood === undefined) return note("accept_dispute_claim", false, "Refused in code: build the case first (call gather_evidence) so the evidence strength is known.");
          const amount = Number(dispute.dispute_amount.value);
          const auto = mayAutoFile({ action: "accept_claim", amount, strength: strengthOf(likelihood), settings });
          if (!auto.ok) {
            await propose(dispute_id, { action: "accept_claim", text, why: `Accept the claim and refund $${amount.toFixed(2)}. ${auto.reason}`, ai });
            return note("accept_dispute_claim", true, `Not sent. ${auto.reason} A proposal is waiting for approval.`);
          }
          // Auto-accept: claim, call, record all happen inside fileAction.
          const result = await fileAction({ disputeId: dispute_id, action: "accept_claim", by: "marlow-auto", payload: { text } });
          return note("accept_dispute_claim", result.filing.status === "done", `Accepted under the merchant's auto-accept rule. ${auto.reason} PayPal status is now ${result.detail.dispute.status}.`);
        }),
    }),

    gather_evidence: tool({
      description:
        "Build the case file for a dispute: order, capture and tracking from PayPal, the store's own records, photo reads, then the rule-based checklist, win estimate and recommendation. Call this before proposing anything.",
      parameters: z.object({ dispute_id: z.string() }),
      execute: async ({ dispute_id }) =>
        withFeature("Agent tool: gather_evidence", async () => {
          const { detail } = await prepareCase(dispute_id, { explain: false, draft: true });
          const rec = detail.recommendation;
          const summary = {
            readiness: detail.checklist.filter((c) => c.required).map((c) => `${c.label}: ${c.status}`),
            checklist: detail.checklist.map((c) => ({ item: c.label, status: c.status, detail: c.detail, points: c.points })),
            rule_decision: rec ? { action: rec.action, via: rec.via, win_estimate_percent: rec.likelihood, offer_amount: rec.offerAmount, approval: rec.approval, approval_reason: rec.approvalReason } : null,
            allowed_by_paypal_now: detail.dispute.links?.map((l) => l.rel).filter((r) => r !== "self"),
            draft_response: detail.draft?.letter ?? null,
          };
          note("gather_evidence", true, `Case built: ${rec?.action ?? "no decision"} at ${rec?.likelihood ?? "?"}% win estimate, ${detail.checklist.filter((c) => c.status === "present").length} of ${detail.checklist.length} items present.`);
          return JSON.stringify(summary);
        }),
    }),

    provide_evidence: tool({
      description:
        "Propose filing the response and the evidence pack with PayPal (provide-evidence, or provide-supporting-info when PayPal is already reviewing). Checked against the dispute's links. Always needs a person's approval.",
      parameters: z.object({ dispute_id: z.string(), notes: z.string().describe("The response text to send with the evidence pack") }),
      execute: async ({ dispute_id, notes }) =>
        withFeature("Agent tool: provide_evidence (guarded)", async () => {
          const dispute = await getDispute(dispute_id, "Agent tool: check evidence can be filed");
          const via = (["provide_evidence", "appeal", "provide_supporting_info"] as DisputeAction[]).find((a) => checkAllowedByPayPal(dispute, a).ok);
          if (!via) return note("provide_evidence", false, `Refused in code: PayPal does not allow evidence on this dispute right now (status ${dispute.status}).`);
          const detail = await loadCase(dispute_id);
          if (!detail?.evidence) return note("provide_evidence", false, "Refused in code: no evidence gathered yet. Call gather_evidence first.");
          await propose(dispute_id, { action: via, text: notes.slice(0, 1900), why: `File the response and the evidence pack through ${via.replace(/_/g, "-")}.`, ai });
          return note("provide_evidence", true, `Proposal recorded: file through ${via.replace(/_/g, "-")}. Waiting for a person to approve.`);
        }),
    }),

    make_offer: tool({
      description: "Propose a partial refund offer to the buyer. Checked against the dispute's links and the amount PayPal allows. Always needs a person's approval.",
      parameters: z.object({ dispute_id: z.string(), amount: z.number().positive().describe("Offer amount in the dispute currency"), note: z.string().describe("Message to the buyer explaining the offer") }),
      execute: async ({ dispute_id, amount, note: text }) =>
        withFeature("Agent tool: make_offer (guarded)", async () => {
          const { dispute, allowed } = await preflight(dispute_id, "make_offer");
          if (!allowed.ok) return note("make_offer", false, `Refused in code: ${allowed.reason}`);
          const check = checkOfferAmount(dispute, amount);
          if (!check.ok) return note("make_offer", false, `Refused in code: ${check.reason}`);
          await propose(dispute_id, { action: "make_offer", text: text.slice(0, 1900), offerAmount: Math.round(amount * 100) / 100, why: `Offer the buyer $${amount.toFixed(2)} to settle.`, ai });
          return note("make_offer", true, `Proposal recorded: offer $${amount.toFixed(2)}. Waiting for a person to approve.`);
        }),
    }),

    send_message: tool({
      description: "Propose a message to the buyer about the dispute (inquiry stage only). Checked against the dispute's links. Needs a person's approval.",
      parameters: z.object({ dispute_id: z.string(), message: z.string() }),
      execute: async ({ dispute_id, message }) =>
        withFeature("Agent tool: send_message (guarded)", async () => {
          const { allowed } = await preflight(dispute_id, "send_message");
          if (!allowed.ok) return note("send_message", false, `Refused in code: ${allowed.reason}`);
          await propose(dispute_id, { action: "send_message", text: message.slice(0, 1900), why: "Send this message to the buyer.", ai });
          return note("send_message", true, "Proposal recorded: message to the buyer. Waiting for a person to approve.");
        }),
    }),

    schedule_work_block: tool({
      description:
        "Book time on the team board for a dispute. With no person or time, the deterministic scheduler picks the earliest free slot before the deadline. With a person and a start time it pins the block there, if that is inside their working hours and before the deadline.",
      parameters: z.object({
        dispute_id: z.string(),
        person_id: z.string().optional().describe("Team member id, for example sam, jo or dee"),
        start: z.string().optional().describe("ISO 8601 start time"),
      }),
      execute: async ({ dispute_id, person_id, start }) =>
        withFeature("Agent tool: schedule_work_block", async () => {
          const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
          const meta = desk.cases[dispute_id];
          if (!meta) return note("schedule_work_block", false, "Refused in code: unknown dispute.");
          if (!meta.needsSeller) return note("schedule_work_block", false, "Refused in code: this dispute does not need the seller right now, so there is nothing to book.");
          if (person_id && start) {
            const person = settings.team.find((p) => p.id === person_id || p.name.toLowerCase().startsWith(person_id.toLowerCase()));
            const at = new Date(start);
            if (!person) return note("schedule_work_block", false, `Refused in code: no team member "${person_id}".`);
            if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60_000) return note("schedule_work_block", false, "Refused in code: the start time is invalid or in the past.");
            const local = zonedParts(at, settings.timezone);
            const hour = local.hour + local.minute / 60;
            const end = new Date(at.getTime() + meta.effortMinutes * 60_000);
            if (!person.days.includes(local.weekday) || hour < person.start || hour + meta.effortMinutes / 60 > person.end) {
              return note("schedule_work_block", false, `Refused in code: ${person.name} does not work then (hours ${person.start}:00 to ${person.end}:00).`);
            }
            if (meta.dueAt && end.getTime() > new Date(meta.dueAt).getTime()) return note("schedule_work_block", false, "Refused in code: that is after the deadline.");
            await moveBlock({ disputeId: dispute_id, resourceId: person.id, start: at.toISOString(), end: end.toISOString() });
            return note("schedule_work_block", true, `Booked ${person.name.split(" ")[0]} ${slotLabel(at, settings.timezone)} and pinned it.`);
          }
          const outcome = await autoSchedule({});
          const mine = outcome.placements.find((p) => p.disputeId === dispute_id);
          const existing = (await loadDesk()).blocks.find((b) => b.disputeId === dispute_id);
          const why = mine?.why ?? existing?.why ?? "No slot was found.";
          return note("schedule_work_block", Boolean(mine?.block ?? existing), why);
        }),
    }),
  };
}

/** After a proposal is approved or dismissed, keep the case file in step. */
export async function resolveProposal(disputeId: string, proposalId: string, status: "approved" | "dismissed"): Promise<void> {
  const detail = await loadCase(disputeId);
  if (!detail?.proposals) return;
  detail.proposals = detail.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p));
  await saveCase(detail);
  await refreshCase(disputeId).catch(() => undefined);
}
