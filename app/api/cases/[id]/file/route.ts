import { route } from "@/lib/api/route";
import { boardView } from "@/lib/desk/board";
import { DeskError, fileAction, type FilingPayload } from "@/lib/desk/filing";
import { loadCase, loadDesk, loadSettings } from "@/lib/desk/state";
import { renderPackPdf } from "@/lib/pack/pdf";
import { ACTION_RELS, type DisputeAction } from "@/lib/paypal/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The merchant approved: act through the Disputes API. The action is checked against the
 * dispute's links and the money guards in lib/desk/filing.ts before PayPal is called.
 */
export const POST = route("File: act on the dispute", async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    text?: string;
    offerAmount?: number;
    offerType?: FilingPayload["offerType"];
    outcome?: FilingPayload["outcome"];
    acknowledgementType?: string;
    attachPack?: boolean;
  } | null;
  const action = body?.action as DisputeAction | undefined;
  if (!action || !ACTION_RELS.includes(action)) throw new DeskError(422, "BAD_ACTION", "Unknown dispute action.");

  const payload: FilingPayload = {
    text: body?.text,
    offerAmount: typeof body?.offerAmount === "number" ? body.offerAmount : undefined,
    offerType: body?.offerType,
    outcome: body?.outcome,
    acknowledgementType: body?.acknowledgementType,
  };

  // Evidence, supporting info and appeals carry the evidence pack PDF.
  const wantsPack = ["provide_evidence", "provide_supporting_info", "appeal"].includes(action) && body?.attachPack !== false;
  let renderer: string | null = null;
  if (wantsPack) {
    const detail = await loadCase(ctx.params.id);
    if (!detail?.evidence) throw new DeskError(409, "NO_PACK", "Build the case first, so there is evidence to attach.");
    if (!payload.text && detail.draft) payload.text = detail.draft.notes;
    const pdf = await renderPackPdf(detail);
    renderer = pdf.renderer;
    payload.files = [{ name: `evidence-pack-${ctx.params.id}.pdf`, type: "application/pdf", data: pdf.bytes }];
  }

  const result = await fileAction({ disputeId: ctx.params.id, action, by: "person", payload });
  const [desk, settings] = await Promise.all([loadDesk(), loadSettings()]);
  return {
    filing: result.filing,
    unknown: result.unknown,
    detail: result.detail,
    meta: result.meta,
    packRenderer: renderer,
    board: boardView(desk, settings),
  };
});
