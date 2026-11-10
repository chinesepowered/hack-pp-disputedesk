import { route } from "@/lib/api/route";
import { loadDesk } from "@/lib/desk/state";
import { refreshCase } from "@/lib/desk/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The case file. The dispute is re-read from PayPal every time: links decide what is offered. */
export const GET = route("Case file: read dispute", async (_req, ctx) => {
  const { detail, meta } = await refreshCase(ctx.params.id);
  const desk = await loadDesk();
  return {
    detail,
    meta,
    block: desk.blocks.find((b) => b.disputeId === ctx.params.id) ?? null,
    filings: Object.values(desk.filings).filter((f) => f.disputeId === ctx.params.id),
  };
});
