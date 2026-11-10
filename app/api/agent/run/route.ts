import { runAgent } from "@/lib/agent/run";
import { resolveProposal } from "@/lib/agent/tools";
import { route } from "@/lib/api/route";
import { DeskError, fileAction } from "@/lib/desk/filing";
import { loadCase, loadDesk } from "@/lib/desk/state";
import { renderPackPdf } from "@/lib/pack/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Ask Marlow to work a dispute with tools. Money-moving tools are guarded in code. */
export const POST = route(
  "Agent: Marlow works a case",
  async (req) => {
    const body = (await req.json().catch(() => null)) as { disputeId?: string; instruction?: string } | null;
    if (!body?.disputeId) throw new DeskError(422, "BAD_REQUEST", "Which dispute?");
    const result = await runAgent({ disputeId: body.disputeId, instruction: body.instruction ?? "" });
    return { answer: result.answer, ai: result.ai, events: result.events, detail: result.detail, meta: result.meta, usedFallback: result.usedFallback };
  },
  { ai: true },
);

/** A person approves or dismisses one of Marlow's proposals. Approval files it with PayPal. */
export const PUT = route("Agent: approve Marlow's proposal", async (req) => {
  const body = (await req.json().catch(() => null)) as { disputeId?: string; proposalId?: string; decision?: "approve" | "dismiss" } | null;
  if (!body?.disputeId || !body.proposalId || !body.decision) throw new DeskError(422, "BAD_REQUEST", "Which proposal, and approve or dismiss?");
  const detail = await loadCase(body.disputeId);
  const proposal = detail?.proposals?.find((p) => p.id === body.proposalId && p.status === "pending");
  if (!detail || !proposal) throw new DeskError(404, "NO_PROPOSAL", "That proposal is no longer pending.");

  if (body.decision === "dismiss") {
    await resolveProposal(body.disputeId, proposal.id, "dismissed");
    const after = await loadCase(body.disputeId);
    return { detail: after, meta: (await loadDesk()).cases[body.disputeId], filing: null };
  }

  const files =
    ["provide_evidence", "provide_supporting_info", "appeal"].includes(proposal.action) && detail.evidence
      ? [{ name: `evidence-pack-${body.disputeId}.pdf`, type: "application/pdf", data: (await renderPackPdf(detail)).bytes }]
      : undefined;
  // fileAction re-reads the dispute and runs every guard again: approval does not skip them.
  const result = await fileAction({
    disputeId: body.disputeId,
    action: proposal.action,
    by: "person",
    payload: { text: proposal.text, offerAmount: proposal.offerAmount, offerType: "REFUND", files },
  });
  await resolveProposal(body.disputeId, proposal.id, "approved");
  const after = await loadCase(body.disputeId);
  return { detail: after, meta: result.meta, filing: result.filing, unknown: result.unknown };
});
