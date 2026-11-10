/** The board view: what counts as booked, and what goes back to Unscheduled. */
import { describe, expect, it } from "vitest";
import { boardView, isMissed } from "@/lib/desk/board";
import { EMPTY_DESK, type CaseMeta, type Desk, type WorkBlock } from "@/lib/desk/types";
import { settings } from "./helpers";

const open = (id: string): CaseMeta => ({ disputeId: id, needsSeller: true, outcome: null, dueAt: "2026-11-20T20:00:00Z", amount: 40 }) as CaseMeta;
const block = (id: string, start: string, end: string): WorkBlock => ({ id: `blk-${id}`, disputeId: id, resourceId: "sam", start, end, pinned: false, why: "" });

describe("board view", () => {
  const now = new Date("2026-11-10T18:45:00Z");
  const desk: Desk = {
    ...EMPTY_DESK,
    cases: { past: open("past"), running: open("running"), later: open("later"), none: open("none") },
    blocks: [
      block("past", "2026-11-10T17:00:00Z", "2026-11-10T17:30:00Z"),
      block("running", "2026-11-10T18:30:00Z", "2026-11-10T19:00:00Z"),
      block("later", "2026-11-10T20:00:00Z", "2026-11-10T20:30:00Z"),
    ],
  };

  it("a block is missed once its end has passed, not while it is running", () => {
    expect(isMissed(desk.blocks[0], now)).toBe(true);
    expect(isMissed(desk.blocks[1], now)).toBe(false);
    expect(isMissed(desk.blocks[2], now)).toBe(false);
  });

  it("a missed block is not shown as booked: its case goes back to Unscheduled", () => {
    const view = boardView(desk, settings, now);
    expect(view.blocks.map((b) => b.disputeId)).toEqual(["running", "later"]);
    expect(view.unscheduled.sort()).toEqual(["none", "past"]);
  });
});
