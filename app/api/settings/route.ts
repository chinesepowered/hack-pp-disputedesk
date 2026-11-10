import { route } from "@/lib/api/route";
import { DeskError } from "@/lib/desk/filing";
import { loadSettings, saveSettings } from "@/lib/desk/state";
import { DEFAULT_SETTINGS, type Person, type Settings } from "@/lib/desk/types";

export const dynamic = "force-dynamic";

export const GET = route("Settings: read", async () => ({ settings: await loadSettings() }));

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Thresholds and working hours. Validated here because the money guards read them. */
export const PUT = route("Settings: save thresholds", async (req) => {
  const body = (await req.json().catch(() => null)) as Partial<Settings> | null;
  if (!body) throw new DeskError(422, "BAD_SETTINGS", "Nothing to save.");
  const current = await loadSettings();
  const team: Person[] = Array.isArray(body.team)
    ? current.team.map((p) => {
        const incoming = body.team!.find((x) => x.id === p.id);
        if (!incoming || p.isAgent) return p;
        const start = num(incoming.start, 0, 23, p.start);
        const end = num(incoming.end, start + 1, 24, p.end);
        const days = Array.isArray(incoming.days) ? incoming.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : p.days;
        return { ...p, start, end, days: days.length ? days : p.days };
      })
    : current.team;
  const next: Settings = {
    ...current,
    autoAcceptEnabled: typeof body.autoAcceptEnabled === "boolean" ? body.autoAcceptEnabled : current.autoAcceptEnabled,
    autoAcceptUnder: num(body.autoAcceptUnder, 0, 500, current.autoAcceptUnder),
    alwaysAskAbove: num(body.alwaysAskAbove, 0, 100000, current.alwaysAskAbove),
    hourlyCost: num(body.hourlyCost, 0, 1000, current.hourlyCost),
    disputeFee: num(body.disputeFee, 0, 500, current.disputeFee),
    autoSchedule: typeof body.autoSchedule === "boolean" ? body.autoSchedule : current.autoSchedule,
    timezone: DEFAULT_SETTINGS.timezone,
    team,
  };
  if (next.autoAcceptUnder > next.alwaysAskAbove) {
    throw new DeskError(422, "BAD_SETTINGS", "The auto-accept ceiling cannot be above the always-ask amount.");
  }
  await saveSettings(next);
  return { settings: next };
});
