/**
 * The scheduling algorithm. Deterministic: same inputs, same board.
 *
 * Each open dispute becomes one work block, sized by expected effort and placed in the earliest
 * free time before its PayPal deadline, inside each person's working hours and daily cap for
 * dispute work. Blocks a person placed by hand (pinned) are never moved; everything else flows
 * around them. Marlow (the agent) only takes work it is allowed to finish alone.
 *
 * The AI does not schedule. It only gets the `why` strings produced here to explain the plan.
 */
import type { Person, WorkBlock } from "@/lib/desk/types";
import { addZonedDays, dayLabel, slotLabel, zonedToUtc } from "./time";

export type SchedCase = {
  disputeId: string;
  label: string;
  dueAt: string | null;
  effortMinutes: number;
  amount: number;
  agentCanHandle: boolean;
};

export type SchedInput = {
  now: Date;
  timezone: string;
  people: Person[];
  /** Blocks to keep exactly where they are (pinned by a person, or already under way). */
  fixed: WorkBlock[];
  cases: SchedCase[];
  /** Minutes of dispute work per person per day. People have other jobs too. */
  dailyCapMinutes?: number;
  horizonDays?: number;
};

export type Placement = {
  disputeId: string;
  block: WorkBlock | null;
  why: string;
};

const SLOT_MS = 15 * 60_000;
const ceilSlot = (ms: number) => Math.ceil(ms / SLOT_MS) * SLOT_MS;

type Interval = { start: number; end: number };

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function minutesOnDay(busy: Interval[], dayStart: number, dayEnd: number): number {
  return busy.reduce((sum, b) => sum + Math.max(0, Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)), 0) / 60_000;
}

/** Earliest slot of `minutes` for one person, or null inside the horizon. */
export function earliestSlot(
  person: Person,
  busy: Interval[],
  minutes: number,
  from: Date,
  timezone: string,
  dailyCapMinutes: number,
  horizonDays: number,
): Interval | null {
  const need = minutes * 60_000;
  const fromMs = ceilSlot(from.getTime());
  for (let offset = 0; offset < horizonDays; offset++) {
    const day = addZonedDays(from, offset, timezone);
    if (!person.days.includes(day.weekday)) continue;
    const windowStart = zonedToUtc(day.year, day.month, day.day, person.start, timezone).getTime();
    const windowEnd = zonedToUtc(day.year, day.month, day.day, person.end, timezone).getTime();
    // The agent has no daily cap: it works through its queue inside its visible hours.
    if (!person.isAgent && minutesOnDay(busy, windowStart, windowEnd) + minutes > dailyCapMinutes) continue;
    let start = Math.max(windowStart, fromMs);
    while (start + need <= windowEnd) {
      const candidate = { start, end: start + need };
      const clash = busy.find((b) => overlaps(candidate, b));
      if (!clash) return candidate;
      start = ceilSlot(clash.end);
    }
  }
  return null;
}

export function scheduleCases(input: SchedInput): { blocks: WorkBlock[]; placements: Placement[] } {
  const { now, timezone, people } = input;
  const cap = input.dailyCapMinutes ?? 150;
  const horizon = input.horizonDays ?? 30;
  const blocks: WorkBlock[] = [...input.fixed];
  const placements: Placement[] = [];
  const busy = new Map<string, Interval[]>();
  for (const p of people) busy.set(p.id, []);
  for (const b of input.fixed) {
    busy.get(b.resourceId)?.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
  }
  const fixedIds = new Set(input.fixed.map((b) => b.disputeId));

  // Nearest deadline first, then the larger amount.
  const queue = input.cases
    .filter((c) => !fixedIds.has(c.disputeId))
    .sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return da - db || b.amount - a.amount || a.disputeId.localeCompare(b.disputeId);
    });

  const humans = people.filter((p) => !p.isAgent);
  const agent = people.find((p) => p.isAgent);

  for (const c of queue) {
    const due = c.dueAt ? new Date(c.dueAt).getTime() : null;
    const candidates = c.agentCanHandle && agent ? [agent] : humans;
    let best: { person: Person; slot: Interval } | null = null;
    for (const person of candidates) {
      const slot = earliestSlot(person, busy.get(person.id) ?? [], c.effortMinutes, now, timezone, cap, horizon);
      if (!slot) continue;
      if (
        !best ||
        slot.end < best.slot.end ||
        (slot.end === best.slot.end && (busy.get(person.id)?.length ?? 0) < (busy.get(best.person.id)?.length ?? 0))
      ) {
        best = { person, slot };
      }
    }
    if (!best) {
      placements.push({ disputeId: c.disputeId, block: null, why: `No free time for ${c.label} in the next ${horizon} days.` });
      continue;
    }
    if (due !== null && best.slot.end > due) {
      placements.push({
        disputeId: c.disputeId,
        block: null,
        why: `No free slot before the ${dayLabel(new Date(due), timezone)} deadline for ${c.label}. Drag it onto the board to book it by hand.`,
      });
      continue;
    }
    const start = new Date(best.slot.start);
    const who = best.person.isAgent ? "Marlow" : best.person.name.split(" ")[0];
    const why = due
      ? `Booked ${who} ${slotLabel(start, timezone)}, the earliest free slot before ${dayLabel(new Date(due), timezone)}'s deadline.`
      : `Booked ${who} ${slotLabel(start, timezone)}, the earliest free slot.`;
    const block: WorkBlock = {
      id: `blk-${c.disputeId}`,
      disputeId: c.disputeId,
      resourceId: best.person.id,
      start: start.toISOString(),
      end: new Date(best.slot.end).toISOString(),
      pinned: false,
      why,
    };
    blocks.push(block);
    busy.get(best.person.id)?.push(best.slot);
    placements.push({ disputeId: c.disputeId, block, why });
  }
  return { blocks, placements };
}
