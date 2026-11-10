import { route } from "@/lib/api/route";
import { preventionCards } from "@/lib/desk/patterns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Patterns across cases, counted deterministically and phrased by the model. */
export const GET = route("Prevention: patterns across cases", async () => preventionCards(), { ai: true });
