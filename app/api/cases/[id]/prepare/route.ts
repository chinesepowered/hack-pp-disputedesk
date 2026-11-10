import { route } from "@/lib/api/route";
import { prepareCase } from "@/lib/desk/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Marlow builds the case: evidence from PayPal and the store's records, photo reads, the
 * rule-based recommendation, then the explanation and the draft response.
 */
export const POST = route(
  "Case file: Marlow builds the case",
  async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as { explain?: boolean; draft?: boolean; force?: boolean };
    const { detail, meta } = await prepareCase(ctx.params.id, {
      explain: body.explain !== false,
      draft: body.draft !== false,
      force: Boolean(body.force),
    });
    return { detail, meta };
  },
  { ai: true },
);
