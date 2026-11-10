import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { addTrail, loadCase, saveCase } from "@/lib/desk/state";

export const dynamic = "force-dynamic";

/** The merchant edits Marlow's draft before approving it. */
export const PUT = route("Case file: edit the draft", async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as { letter?: string } | null;
  const letter = (body?.letter ?? "").replace(/[\u2014\u2013]/g, ",").trim();
  if (!letter) throw new DeskError(422, "EMPTY_DRAFT", "The response cannot be empty.");
  if (letter.length > 4000) throw new DeskError(422, "DRAFT_TOO_LONG", "Keep the response under 4,000 characters.");
  const detail = await loadCase(ctx.params.id);
  if (!detail) throw new DeskError(404, "UNKNOWN_CASE", "No case file for this dispute yet.");
  detail.draft = {
    letter,
    notes: letter.slice(0, 1900),
    evidenceType: detail.draft?.evidenceType ?? null,
    ai: detail.draft?.ai ?? null,
    generatedAt: detail.draft?.generatedAt ?? new Date().toISOString(),
    editedAt: new Date().toISOString(),
  };
  addTrail(detail, { actor: "person", kind: "note", title: "Edited the response", detail: `${letter.split(/\s+/).length} words.` });
  await saveCase(detail);
  return { detail };
});
