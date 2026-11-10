import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { loadCase } from "@/lib/desk/state";
import { packHtml } from "@/lib/pack/html";
import { renderPackPdf } from "@/lib/pack/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The evidence pack: HTML to read in the app, or the PDF that gets attached when filing. */
export const GET = route("Case file: evidence pack", async (req, ctx) => {
  const detail = await loadCase(ctx.params.id);
  if (!detail?.evidence) throw new DeskError(404, "NO_PACK", "Build the case first: there is no evidence to pack yet.");
  const format = new URL(req.url).searchParams.get("format") ?? "html";
  if (format === "pdf") {
    const pdf = await renderPackPdf(detail);
    return new Response(pdf.bytes as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="evidence-pack-${ctx.params.id}.pdf"`,
        "X-Pack-Renderer": pdf.renderer,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(await packHtml(detail), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
});
