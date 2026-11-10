/** Board operations: the view the Scheduler renders, auto-scheduling and manual moves. */
import { explainSchedule } from "@/lib/ai/tasks";
import { scheduleCases, type Placement, type SchedCase } from "@/lib/schedule/scheduler";
import { reasonTitle } from "@/lib/rules/evidence-table";
import { currentMode } from "@/lib/paypal/log";
import { loadSettings, updateDesk } from "./state";
import type { AiTag, CaseMeta, Desk, Settings, WorkBlock } from "./types";

const SLOT_MS = 15 * 60_000;

export function caseLabel(c: CaseMeta): string {
  return `${c.customer ?? "a customer"}'s $${c.amount.toFixed(0)} ${reasonTitle(c.reason).toLowerCase()} case`;
}

function toSched(c: CaseMeta): SchedCase {
  return { disputeId: c.disputeId, label: caseLabel(c), dueAt: c.dueAt, effortMinutes: c.effortMinutes, amount: c.amount, agentCanHandle: c.agentCanHandle };
}

const monthKey = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" }).format(date);

export function recoveredThisMonth(desk: Desk, timezone: string, now = new Date()): { amount: number; won: number; resolved: number } {
  const month = monthKey(now, timezone);
  let amount = 0;
  let won = 0;
  let resolved = 0;
  for (const c of Object.values(desk.cases)) {
    if (!c.outcome) continue;
    const at = c.outcome.resolvedAt ? new Date(c.outcome.resolvedAt) : now;
    if (monthKey(at, timezone) !== month) continue;
    resolved++;
    if (c.outcome.wonAmount > 0) {
      won++;
      amount += c.outcome.wonAmount;
    }
  }
  return { amount: Math.round(amount * 100) / 100, won, resolved };
}

/** A block whose time has gone by. If its case still needs a response, the work was missed. */
export function isMissed(block: WorkBlock, now = new Date()): boolean {
  return new Date(block.end).getTime() <= now.getTime();
}

export function boardView(desk: Desk, settings: Settings, now = new Date()) {
  const cases = Object.values(desk.cases).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"));
  // Missed blocks are not shown as booked: their cases go back to Unscheduled until Marlow
  // (or a person) books them again, so the board never shows a plan that is already in the past.
  const blocks = desk.blocks.filter((b) => !isMissed(b, now));
  const scheduled = new Set(blocks.map((b) => b.disputeId));
  return {
    cases,
    blocks,
    unscheduled: cases.filter((c) => c.needsSeller && !scheduled.has(c.disputeId)).map((c) => c.disputeId),
    waiting: cases.filter((c) => !c.needsSeller && !c.outcome).map((c) => c.disputeId),
    resolved: cases.filter((c) => c.outcome).map((c) => c.disputeId),
    recovered: recoveredThisMonth(desk, settings.timezone),
    team: settings.team,
    timezone: settings.timezone,
    autoSchedule: settings.autoSchedule,
    lastSyncAt: desk.lastSyncAt,
  };
}

export type BoardView = ReturnType<typeof boardView>;

export type ScheduleOutcome = { blocks: WorkBlock[]; placements: Placement[]; note: { text: string; ai: AiTag | null } | null };

/**
 * Marlow books every unscheduled case that needs the seller. Pinned blocks stay; with
 * `reflow` every unpinned block that has not started is placed again around them.
 */
export async function autoSchedule(opts: { reflow?: boolean; explain?: boolean } = {}): Promise<ScheduleOutcome> {
  const settings = await loadSettings();
  const now = new Date();
  let blocks: WorkBlock[] = [];
  let placements: ScheduleOutcome["placements"] = [];
  const desk = await updateDesk((latest) => {
    const open = Object.values(latest.cases).filter((c) => c.needsSeller);
    const openIds = new Set(open.map((c) => c.disputeId));
    // A block whose time passed without a response is booked again, pinned or not.
    const missed = new Set(latest.blocks.filter((b) => openIds.has(b.disputeId) && isMissed(b, now)).map((b) => b.disputeId));
    const existing = latest.blocks.filter((b) => openIds.has(b.disputeId) && !missed.has(b.disputeId));
    const fixed = existing.filter((b) => b.pinned || !opts.reflow || new Date(b.start).getTime() <= now.getTime());
    const fixedIds = new Set(fixed.map((b) => b.disputeId));
    const toPlace = open.filter((c) => !fixedIds.has(c.disputeId));
    ({ blocks, placements } = scheduleCases({
      now,
      timezone: settings.timezone,
      people: settings.team,
      fixed,
      cases: toPlace.map(toSched),
    }));
    for (const b of blocks) {
      if (missed.has(b.disputeId) && !b.why.startsWith("The earlier slot passed")) b.why = `The earlier slot passed with no response, so Marlow moved it. ${b.why}`;
    }
    for (const p of placements) {
      if (p.block && missed.has(p.disputeId)) p.why = p.block.why;
    }
    latest.blocks = blocks;
  });

  let note: ScheduleOutcome["note"] = null;
  const booked = placements.filter((p) => p.block);
  if (booked.length) {
    // Nearest deadline first, so "most urgent" in Marlow's note is a fact and not a guess.
    const byDeadline = [...booked].sort((a, b) => (desk.cases[a.disputeId]?.dueAt ?? "9").localeCompare(desk.cases[b.disputeId]?.dueAt ?? "9"));
    const lines = byDeadline.slice(0, 8).map((p) => `${caseLabel(desk.cases[p.disputeId])}: ${p.why}`);
    // Replay keeps the scheduler's own sentence: a recorded explanation would describe
    // bookings from the day it was recorded.
    if (opts.explain && currentMode() !== "replay") {
      try {
        const res = await explainSchedule(lines);
        note = { text: res.text, ai: res.ai };
      } catch {
        note = { text: booked[0].why, ai: null };
      }
    } else note = { text: booked[0].why, ai: null };
  }
  return { blocks, placements, note };
}

/** A person dragged or resized a block: pin it where they put it, then reflow the rest. */
export async function moveBlock(input: { disputeId: string; resourceId: string; start: string; end: string }): Promise<ScheduleOutcome> {
  const settings = await loadSettings();
  const who = settings.team.find((p) => p.id === input.resourceId);
  if (!who) throw new Error("Unknown team member.");
  // The start snaps to a quarter hour. The length is kept (to five minutes, ten at least), so
  // moving a twenty minute job does not quietly shorten it to fifteen.
  const FIVE = 5 * 60_000;
  const start = Math.round(new Date(input.start).getTime() / SLOT_MS) * SLOT_MS;
  const length = Math.max(2 * FIVE, Math.round((new Date(input.end).getTime() - new Date(input.start).getTime()) / FIVE) * FIVE);
  const end = start + length;
  await updateDesk((desk) => {
    const meta = desk.cases[input.disputeId];
    if (!meta) throw new Error("Unknown dispute.");
    if (who.isAgent && !meta.agentCanHandle) throw new Error("Marlow can only take cases your auto-accept rule covers. Assign this one to a person.");
    const block: WorkBlock = {
      id: `blk-${input.disputeId}`,
      disputeId: input.disputeId,
      resourceId: input.resourceId,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      pinned: true,
      why: `Placed by hand on ${who.name.split(" ")[0]}'s row. Marlow plans around it.`,
    };
    desk.blocks = [...desk.blocks.filter((b) => b.disputeId !== input.disputeId), block];
    meta.effortMinutes = Math.round((end - start) / 60_000);
  });
  return autoSchedule({ reflow: true });
}

export async function unscheduleBlock(disputeId: string): Promise<Desk> {
  return updateDesk((desk) => {
    desk.blocks = desk.blocks.filter((b) => b.disputeId !== disputeId);
  });
}
