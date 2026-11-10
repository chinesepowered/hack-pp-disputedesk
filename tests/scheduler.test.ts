import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type WorkBlock } from "@/lib/desk/types";
import { earliestSlot, scheduleCases, type SchedCase } from "@/lib/schedule/scheduler";
import { zonedParts, zonedToUtc } from "@/lib/schedule/time";

const TZ = "America/Los_Angeles";
const team = DEFAULT_SETTINGS.team;
// Tuesday 10 Nov 2026, 07:40 store time.
const now = zonedToUtc(2026, 11, 10, 7 + 40 / 60, TZ);
const due = (day: number, hour = 17) => zonedToUtc(2026, 11, day, hour, TZ).toISOString();

const c = (id: string, over: Partial<SchedCase> = {}): SchedCase => ({ disputeId: id, label: `${id} case`, dueAt: due(20), effortMinutes: 30, amount: 50, agentCanHandle: false, ...over });

function hours(iso: string) {
  const p = zonedParts(new Date(iso), TZ);
  return { weekday: p.weekday, hour: p.hour + p.minute / 60 };
}

describe("time helpers", () => {
  it("converts store wall-clock time to UTC and back", () => {
    const at = zonedToUtc(2026, 11, 10, 9.5, TZ);
    expect(at.toISOString()).toBe("2026-11-10T17:30:00.000Z"); // PST is UTC-8 in November
    expect(zonedParts(at, TZ)).toMatchObject({ year: 2026, month: 11, day: 10, hour: 9, minute: 30, weekday: 2 });
  });
});

describe("scheduler", () => {
  it("books inside working hours and before the deadline", () => {
    const { blocks, placements } = scheduleCases({ now, timezone: TZ, people: team, fixed: [], cases: [c("A"), c("B"), c("C")] });
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      const person = team.find((p) => p.id === b.resourceId)!;
      const start = hours(b.start);
      const end = hours(b.end);
      expect(person.days).toContain(start.weekday);
      expect(start.hour).toBeGreaterThanOrEqual(person.start);
      expect(end.hour).toBeLessThanOrEqual(person.end);
      expect(new Date(b.end).getTime()).toBeLessThanOrEqual(new Date(due(20)).getTime());
      expect(new Date(b.start).getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
    expect(placements.every((p) => p.why.startsWith("Booked "))).toBe(true);
  });

  it("gives the earliest slot to the nearest deadline, then the larger amount", () => {
    const { blocks } = scheduleCases({
      now,
      timezone: TZ,
      people: team.filter((p) => p.id === "sam"),
      fixed: [],
      cases: [c("late", { dueAt: due(30) }), c("small", { dueAt: due(13), amount: 20 }), c("big", { dueAt: due(13), amount: 200 })],
    });
    const order = [...blocks].sort((a, b) => a.start.localeCompare(b.start)).map((b) => b.disputeId);
    expect(order).toEqual(["big", "small", "late"]);
  });

  it("never overlaps two blocks for one person", () => {
    const cases = Array.from({ length: 9 }, (_, i) => c(`D${i}`, { effortMinutes: 40 }));
    const { blocks } = scheduleCases({ now, timezone: TZ, people: team, fixed: [], cases });
    for (const person of team) {
      const mine = blocks.filter((b) => b.resourceId === person.id).sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < mine.length; i++) expect(new Date(mine[i].start).getTime()).toBeGreaterThanOrEqual(new Date(mine[i - 1].end).getTime());
    }
  });

  it("respects the daily cap for dispute work", () => {
    const cases = Array.from({ length: 6 }, (_, i) => c(`E${i}`, { effortMinutes: 60 }));
    const { blocks } = scheduleCases({ now, timezone: TZ, people: team.filter((p) => p.id === "sam"), fixed: [], cases, dailyCapMinutes: 120 });
    const perDay = new Map<number, number>();
    for (const b of blocks) {
      const day = zonedParts(new Date(b.start), TZ).day;
      perDay.set(day, (perDay.get(day) ?? 0) + 60);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(120);
    expect(perDay.size).toBe(3);
  });

  it("leaves pinned blocks exactly where a person put them and flows around them", () => {
    const pinned: WorkBlock = { id: "blk-P", disputeId: "P", resourceId: "sam", start: zonedToUtc(2026, 11, 10, 9, TZ).toISOString(), end: zonedToUtc(2026, 11, 10, 10, TZ).toISOString(), pinned: true, why: "by hand" };
    const { blocks } = scheduleCases({ now, timezone: TZ, people: team.filter((p) => p.id === "sam"), fixed: [pinned], cases: [c("P"), c("Q")] });
    expect(blocks.find((b) => b.disputeId === "P")).toEqual(pinned);
    const q = blocks.find((b) => b.disputeId === "Q")!;
    expect(new Date(q.start).getTime()).toBeGreaterThanOrEqual(new Date(pinned.end).getTime());
    expect(blocks.filter((b) => b.disputeId === "P")).toHaveLength(1);
  });

  it("only gives Marlow work it may finish alone", () => {
    const { blocks } = scheduleCases({ now, timezone: TZ, people: team, fixed: [], cases: [c("auto", { agentCanHandle: true, effortMinutes: 10 }), c("human")] });
    expect(blocks.find((b) => b.disputeId === "auto")?.resourceId).toBe("marlow");
    expect(blocks.find((b) => b.disputeId === "human")?.resourceId).not.toBe("marlow");
  });

  it("leaves a case unscheduled, with the reason, when nothing fits before the deadline", () => {
    const soon = new Date(now.getTime() + 20 * 60_000).toISOString();
    const { blocks, placements } = scheduleCases({ now, timezone: TZ, people: team.filter((p) => p.id === "sam"), fixed: [], cases: [c("rush", { dueAt: soon })] });
    expect(blocks).toHaveLength(0);
    expect(placements[0].block).toBeNull();
    expect(placements[0].why).toMatch(/No free slot before/);
  });

  it("is deterministic", () => {
    const cases = [c("A"), c("B", { amount: 90 }), c("C", { dueAt: due(13) })];
    const a = scheduleCases({ now, timezone: TZ, people: team, fixed: [], cases });
    const b = scheduleCases({ now, timezone: TZ, people: team, fixed: [], cases: [...cases].reverse() });
    expect(a.blocks.map((x) => [x.disputeId, x.resourceId, x.start])).toEqual(b.blocks.map((x) => [x.disputeId, x.resourceId, x.start]).sort((x, y) => a.blocks.findIndex((k) => k.disputeId === x[0]) - a.blocks.findIndex((k) => k.disputeId === y[0])));
  });

  it("skips days a person does not work", () => {
    const dee = team.find((p) => p.id === "dee")!; // Monday to Thursday, mornings
    const friday = zonedToUtc(2026, 11, 13, 9, TZ);
    const slot = earliestSlot(dee, [], 30, friday, TZ, 150, 30)!;
    expect(zonedParts(new Date(slot.start), TZ).weekday).toBe(1);
  });
});
