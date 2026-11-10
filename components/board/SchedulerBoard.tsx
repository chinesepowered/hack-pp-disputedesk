"use client";

/**
 * The triage board: Bryntum Scheduler (trial build), loaded client-only.
 *
 * - Resources are the team plus Marlow. Events are work blocks, one per dispute.
 * - Time ranges mark deadlines (PayPal's due dates as solid lines, the desk's own targets dashed).
 * - Resource time ranges shade each person's non-working hours.
 * - Drag to reassign, resize to change effort, double-click (or Enter) for the event editor,
 *   drag a row from the Unscheduled grid onto the timeline to book it.
 * - When Marlow schedules, the new blocks are applied through the Scheduler's event store one
 *   after another, so the board visibly fills in.
 */
import { DateHelper, DragHelper, StringHelper, type EventModel, type Grid, type Scheduler } from "@bryntum/scheduler";
import { BryntumGrid, BryntumScheduler } from "@bryntum/scheduler-react";
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { dueText, money, READINESS_LABEL, reasonLabel, stageLabel } from "@/components/ui/atoms";
import type { CaseMeta, Person, WorkBlock } from "@/lib/desk/types";
import { addZonedDays, zonedParts, zonedToUtc } from "@/lib/schedule/time";

export type BoardHandlers = {
  onMove: (input: { disputeId: string; resourceId: string; start: string; end: string }) => void;
  onUnschedule: (disputeId: string) => void;
  onOpen: (disputeId: string) => void;
  onSelect: (disputeId: string | null) => void;
};

type Props = {
  cases: CaseMeta[];
  blocks: WorkBlock[];
  unscheduled: string[];
  team: Person[];
  timezone: string;
  /** Ids Marlow just booked: these animate in one by one. */
  justBooked: string[];
  handlers: BoardHandlers;
};

const DAY_START = 7;
const DAY_END = 19;
const enc = (s: unknown) => StringHelper.encodeHtml(String(s ?? ""));

/** The two lines of text on a block. The block's accessible name starts with the same words. */
function blockLines(c: CaseMeta | undefined, readiness: string, fallback: string): { title: string; detail: string } {
  const label = readiness === "unknown" ? "Not assessed yet" : READINESS_LABEL[readiness as keyof typeof READINESS_LABEL];
  const short = label.replace("Evidence ", "").replace(/^./, (ch: string) => ch.toUpperCase());
  if (!c) return { title: fallback, detail: short };
  return { title: `${(c.customer ?? "Customer").split(" ")[0]} · ${money(c.amount)}`, detail: `${short} · ${reasonLabel(c.reason)}` };
}

function eventData(block: WorkBlock, c: CaseMeta | undefined) {
  const lines = blockLines(c, c?.readiness ?? "unknown", block.disputeId);
  return {
    id: block.id,
    resourceId: block.resourceId,
    startDate: new Date(block.start),
    endDate: new Date(block.end),
    // Read out as "for 30 minutes", not as a fraction of a day.
    durationUnit: "minute",
    // The Scheduler builds the block's accessible name from this, so it begins with the text
    // that is visible on the block and then gives the customer's full name.
    name: c ? `${lines.title} ${lines.detail} (${c.customer ?? "customer"})` : block.disputeId,
    disputeId: block.disputeId,
    readiness: c?.readiness ?? "unknown",
    pinned: block.pinned,
    why: block.why,
    draggable: true,
    resizable: true,
  };
}

/** Drag a dispute from the Unscheduled grid onto a person's row (Bryntum's drag-from-grid pattern). */
class UnscheduledDrag extends DragHelper {
  static get configurable() {
    return {
      callOnFunctions: true,
      cloneTarget: true,
      autoSizeClonedTarget: false,
      unifiedProxy: true,
      removeProxyAfterDrop: true,
      dropTargetSelector: ".b-timeline-subgrid, .b-timeline-sub-grid, .b-sch-timeaxis-cell",
      targetSelector: ".b-grid-row:not(.b-group-row)",
    };
  }

  declare grid: Grid;
  declare schedule: Scheduler;
  declare onBook: (disputeId: string, resourceId: string, date: Date) => void;
  declare canAgentTake: (disputeId: string) => boolean;

  createProxy(element: HTMLElement) {
    const record = this.grid.getRecordFromElement(element) as any;
    const proxy = document.createElement("div");
    proxy.className = "desk-drag-proxy";
    proxy.textContent = record ? `Book ${record.customer} · ${record.amountText}` : "Book dispute";
    return proxy;
  }

  onDragStart = ({ context }: any) => {
    context.record = this.grid.getRecordFromElement(context.grabbed);
    this.schedule.enableScrollingCloseToEdges(this.schedule.timeAxisSubGrid);
    const tip = (this.schedule.features as any).eventTooltip;
    if (tip) tip.disabled = true;
  };

  onDrag = ({ context }: any) => {
    const date = this.schedule.getDateFromCoordinate(context.newX, "round", false);
    const resource = context.target && this.schedule.resolveResourceRecord(context.target);
    const allowedRow = !resource?.isAgent || Boolean(this.canAgentTake?.(context.record?.disputeId));
    context.valid = Boolean(date && resource && allowedRow);
    context.date = date;
    context.resource = resource;
    (context.element as HTMLElement | undefined)?.classList.toggle("invalid", !context.valid);
  };

  onDrop = ({ context }: any) => {
    this.schedule.disableScrollingCloseToEdges(this.schedule.timeAxisSubGrid);
    const tip = (this.schedule.features as any).eventTooltip;
    if (tip) tip.disabled = false;
    if (context.valid && context.record && context.resource && context.date) {
      this.onBook(context.record.disputeId, String(context.resource.id), context.date);
    }
  };
}

export default function SchedulerBoard({ cases, blocks, unscheduled, team, timezone, justBooked, handlers }: Props) {
  const schedulerRef = useRef<BryntumScheduler>(null);
  const gridRef = useRef<BryntumGrid>(null);
  // The Scheduler keeps the callbacks it was created with, so they read the latest props
  // through refs that are refreshed after every render.
  const handlersRef = useRef(handlers);
  const caseMap = useMemo(() => new Map(cases.map((c) => [c.disputeId, c])), [cases]);
  const caseMapRef = useRef(caseMap);
  useEffect(() => {
    handlersRef.current = handlers;
    caseMapRef.current = caseMap;
  }, [handlers, caseMap]);
  const applying = useRef(false);

  // The visible window: from today to a day after the last deadline, at least one working week.
  const range = useMemo(() => {
    const now = new Date();
    const p = zonedParts(now, timezone);
    const start = zonedToUtc(p.year, p.month, p.day, 0, timezone);
    const lastDue = Math.max(0, ...cases.filter((c) => c.needsSeller && c.dueAt).map((c) => new Date(c.dueAt as string).getTime()));
    const lastBlock = Math.max(0, ...blocks.map((b) => new Date(b.end).getTime()));
    const minEnd = start.getTime() + 7 * 86_400_000;
    const end = new Date(Math.max(minEnd, lastDue + 86_400_000, lastBlock + 86_400_000));
    return { start, end };
  }, [cases, blocks, timezone]);

  const resources = useMemo(
    () => team.map((p) => ({ id: p.id, name: p.name, role: p.role, isAgent: Boolean(p.isAgent), hours: `${hh(p.start)} to ${hh(p.end)}` })),
    [team],
  );

  // Deadline markers, one per day and kind, so five cases due on one day read as one clear line.
  const timeRanges = useMemo(() => {
    const groups = new Map<string, { at: number; kind: string; count: number; amount: number }>();
    for (const c of cases) {
      if (!c.needsSeller || !c.dueAt) continue;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(c.dueAt));
      const key = `${day}-${c.dueKind}`;
      const g = groups.get(key) ?? { at: new Date(c.dueAt).getTime(), kind: c.dueKind ?? "paypal", count: 0, amount: 0 };
      g.at = Math.min(g.at, new Date(c.dueAt).getTime());
      g.count++;
      g.amount += c.amount;
      groups.set(key, g);
    }
    return [...groups.entries()].map(([key, g]) => ({
      id: `due-${key}`,
      name: `${g.kind === "paypal" ? "PayPal deadline" : "Desk target"}: ${g.count} ${g.count === 1 ? "case" : "cases"}, ${money(g.amount)}`,
      startDate: new Date(g.at),
      cls: `deadline ${g.kind === "paypal" ? "" : "target"}`,
    }));
  }, [cases, timezone]);

  // Shade the hours each person does not work.
  const resourceTimeRanges = useMemo(() => {
    const out: { id: string; resourceId: string; startDate: Date; endDate: Date; cls: string; name: string }[] = [];
    const days = Math.ceil((range.end.getTime() - range.start.getTime()) / 86_400_000);
    for (const p of team) {
      if (p.isAgent) continue;
      for (let i = 0; i < days; i++) {
        const d = addZonedDays(range.start, i, timezone);
        const at = (h: number) => zonedToUtc(d.year, d.month, d.day, h, timezone);
        const add = (from: number, to: number, tag: string) => {
          if (to > from) out.push({ id: `off-${p.id}-${i}-${tag}`, resourceId: p.id, startDate: at(from), endDate: at(to), cls: "off-hours", name: "" });
        };
        if (!p.days.includes(d.weekday)) add(DAY_START, DAY_END, "day");
        else {
          add(DAY_START, Math.max(DAY_START, p.start), "am");
          add(Math.min(DAY_END, p.end), DAY_END, "pm");
        }
      }
    }
    return out;
  }, [team, range, timezone]);

  const [initialEvents] = useState(() => blocks.map((b) => eventData(b, caseMap.get(b.disputeId))));

  // Apply block changes through the event store so moves and new bookings animate.
  useEffect(() => {
    const scheduler = schedulerRef.current?.instance;
    if (!scheduler) return;
    const store = scheduler.eventStore;
    const wanted = new Map(blocks.map((b) => [b.id, b]));
    applying.current = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const record of [...(store.records as EventModel[])]) {
      if (!wanted.has(String(record.id))) store.remove(record);
    }
    let delay = 0;
    for (const block of blocks) {
      const data = eventData(block, caseMapRef.current.get(block.disputeId));
      const existing = store.getById(block.id) as EventModel | null;
      if (existing) {
        existing.set({ resourceId: data.resourceId, startDate: data.startDate, endDate: data.endDate, name: data.name, readiness: data.readiness, pinned: data.pinned, why: data.why });
      } else if (justBooked.includes(block.disputeId)) {
        // Marlow's bookings appear one after another.
        timers.push(
          setTimeout(() => {
            store.add({ ...data, cls: "just-booked" });
          }, delay),
        );
        delay += 420;
      } else {
        store.add(data);
      }
    }
    timers.push(setTimeout(() => (applying.current = false), delay + 200));
    // Bring Marlow's first new booking into view, so the change is seen where it happens.
    const firstNew = blocks.find((b) => justBooked.includes(b.disputeId));
    if (firstNew) {
      timers.push(
        setTimeout(() => {
          const record = store.getById(firstNew.id) as EventModel | null;
          if (record) void scheduler.scrollEventIntoView(record, { animate: true, block: "center" } as any).catch(() => undefined);
        }, 150),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [blocks, justBooked]);

  // Open on the present: the next booked block, or the current time when nothing is booked.
  // Without this the timeline opens at the start of the day, with the afternoon's work off screen.
  const openedOnPresent = useRef(false);
  useEffect(() => {
    const scheduler = schedulerRef.current?.instance;
    if (!scheduler || openedOnPresent.current) return;
    const now = Date.now();
    const next = blocks.filter((b) => new Date(b.end).getTime() > now).sort((a, b) => a.start.localeCompare(b.start))[0];
    // New bookings scroll themselves into view (above), so only settled boards need this.
    if (next && justBooked.includes(next.disputeId)) return;
    const timer = setTimeout(() => {
      openedOnPresent.current = true;
      const record = next ? (scheduler.eventStore.getById(next.id) as EventModel | null) : null;
      if (record) void scheduler.scrollEventIntoView(record, { animate: false, block: "start", edgeOffset: 90 } as any).catch(() => undefined);
      else void (scheduler as any).scrollToNow?.({ animate: false, block: "center" })?.catch?.(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [blocks, justBooked]);

  // Keep the Unscheduled grid in step.
  const unscheduledRows = useMemo(
    () =>
      unscheduled
        .map((id) => caseMap.get(id))
        .filter((c): c is CaseMeta => Boolean(c))
        .map((c) => ({
          id: c.disputeId,
          disputeId: c.disputeId,
          customer: c.customer ?? "Customer",
          amountText: money(c.amount),
          line: `${reasonLabel(c.reason)} · ${stageLabel(c.stage)} · ${money(c.amount)}`,
          due: dueText(c.dueAt).text,
          effort: c.effortMinutes,
        })),
    [unscheduled, caseMap],
  );

  // Wire the drag-from-grid helper once both widgets exist.
  useEffect(() => {
    const scheduler = schedulerRef.current?.instance;
    const grid = gridRef.current?.instance;
    if (!scheduler || !grid) return;
    const drag = new UnscheduledDrag({
      grid,
      schedule: scheduler,
      outerElement: grid.element,
      canAgentTake: (disputeId: string) => Boolean(caseMapRef.current.get(disputeId)?.agentCanHandle),
      onBook: (disputeId: string, resourceId: string, date: Date) => {
        const c = caseMapRef.current.get(disputeId);
        const minutes = c?.effortMinutes ?? 30;
        handlersRef.current.onMove({ disputeId, resourceId, start: date.toISOString(), end: new Date(date.getTime() + minutes * 60_000).toISOString() });
      },
    } as any);
    return () => drag.destroy();
  }, []);

  const report = (record: EventModel) => {
    if (applying.current) return;
    const r = record as any;
    if (!r.disputeId || !r.startDate || !r.endDate) return;
    handlersRef.current.onMove({ disputeId: r.disputeId, resourceId: String(r.resourceId), start: new Date(r.startDate).toISOString(), end: new Date(r.endDate).toISOString() });
  };

  return (
    <div className="flex flex-col gap-3 xl:flex-row" data-testid="board">
      <div className="desk-scheduler min-w-0 flex-none overflow-hidden rounded-[14px] border border-line bg-surface xl:flex-1" style={{ height: 40 + team.length * 64 + 16 }} data-testid="scheduler">
        <BryntumScheduler
          ref={schedulerRef}
          startDate={range.start}
          endDate={range.end}
          timeZone={timezone}
          viewPreset={{ base: "hourAndDay", tickWidth: 264, headers: [{ unit: "hour", dateFormat: "ddd D MMM, HH:mm" }] } as any}
          workingTime={{ fromHour: DAY_START, toHour: DAY_END }}
          rowHeight={64}
          barMargin={7}
          resources={resources}
          events={initialEvents}
          timeRanges={timeRanges}
          resourceTimeRanges={resourceTimeRanges}
          zoomOnMouseWheel={false}
          zoomOnTimeAxisDoubleClick={false}
          eventStyle={null as any}
          eventColor={null as any}
          snap
          timeResolution={{ unit: "minute", increment: 15 } as any}
          columns={[
            {
              text: "Team",
              field: "name",
              width: typeof window !== "undefined" && window.innerWidth < 640 ? 132 : 214,
              htmlEncode: false,
              renderer: ({ record }: any) =>
                `<div class="desk-resource"><span class="avatar ${record.isAgent ? "agent" : ""}" aria-hidden="true">${enc(initials(record.name))}</span><span class="who"><b>${enc(record.name)}</b><span>${enc(record.role)} · ${enc(record.hours)}</span></span></div>`,
            } as any,
          ]}
          eventRenderer={({ eventRecord, renderData }: any) => {
            const c = caseMapRef.current.get(eventRecord.disputeId);
            const readiness = eventRecord.readiness ?? "unknown";
            renderData.wrapperCls.add(readiness);
            if (eventRecord.pinned) renderData.wrapperCls.add("pinned");
            const lines = blockLines(c, readiness, eventRecord.disputeId ?? "");
            // Very short blocks (Marlow's own quick jobs) only have room for the amount.
            const tiny = eventRecord.endDate - eventRecord.startDate <= 15 * 60_000;
            if (tiny) renderData.wrapperCls.add("tiny");
            return {
              className: tiny ? "desk-block tiny" : "desk-block",
              children: tiny
                ? [{ tag: "b", text: c ? money(c.amount) : "" }]
                : [
                    { tag: "b", text: `${lines.title} ` },
                    { tag: "span", text: lines.detail },
                  ],
            };
          }}
          eventDragFeature={{
            constrainDragToTimeline: true,
            showExactDropPosition: true,
            // Marlow's row only takes work Marlow may finish alone (the auto-accept rule).
            validatorFn: ({ eventRecords, newResource }: any) => {
              if (!newResource?.isAgent) return true;
              const ok = eventRecords.every((r: any) => caseMapRef.current.get(r.disputeId)?.agentCanHandle);
              return ok ? true : { valid: false, message: "Marlow can only take cases your auto-accept rule covers" };
            },
          }}
          eventResizeFeature={{ showExactResizePosition: true }}
          eventDragCreateFeature={false}
          timeRangesFeature={{ showCurrentTimeLine: true, showHeaderElements: true, enableResizing: false }}
          resourceTimeRangesFeature
          scheduleMenuFeature={false}
          timeAxisHeaderMenuFeature={false}
          cellMenuFeature={false}
          headerMenuFeature={false}
          eventCopyPasteFeature={false}
          eventMenuFeature={{
            items: {
              deleteEvent: { text: "Back to Unscheduled", icon: "b-fa b-fa-inbox" },
              copyEvent: false,
              cutEvent: false,
              splitEvent: false,
              unassignEvent: false,
              openCase: {
                text: "Open case file",
                icon: "b-fa b-fa-folder-open",
                weight: 50,
                onItem: ({ eventRecord }: any) => handlersRef.current.onOpen(eventRecord.disputeId),
              },
            },
          } as any}
          eventEditFeature
          eventTooltipFeature={{
            template: ({ eventRecord }: any) => {
              const c = caseMapRef.current.get(eventRecord.disputeId);
              if (!c) return enc(eventRecord.name);
              const readiness = c.readiness ? READINESS_LABEL[c.readiness] : "Not assessed yet";
              return `<div class="desk-tip"><h4>${enc(c.customer ?? "Customer")} · ${enc(money(c.amount))}</h4>
                <div>${enc(c.product ?? "")}</div>
                <dl>
                  <dt>Reason</dt><dd>${enc(reasonLabel(c.reason))}, ${enc(stageLabel(c.stage))}</dd>
                  <dt>${c.dueKind === "target" ? "Desk target" : "PayPal deadline"}</dt><dd>${enc(c.dueAt ? DateHelper.format(new Date(c.dueAt), "ddd MMM D, HH:mm") : "none")} (${enc(dueText(c.dueAt).text.toLowerCase())})</dd>
                  <dt>Evidence</dt><dd>${enc(readiness)}${c.likelihood !== null ? `, win estimate ${c.likelihood}%` : ""}</dd>
                  <dt>Effort</dt><dd>${c.effortMinutes} min</dd>
                </dl>
                <div class="why">${enc(eventRecord.why ?? "")}</div></div>`;
            },
          }}
          onAfterEventDrop={({ eventRecords, valid }: any) => {
            if (valid) eventRecords.forEach(report);
          }}
          onEventResizeEnd={({ changed, eventRecord }: any) => {
            if (changed) report(eventRecord);
          }}
          onAfterEventSave={({ eventRecord }: any) => report(eventRecord)}
          onBeforeEventEdit={({ eventRecord }: any) => Boolean(eventRecord?.disputeId)}
          onBeforeEventDelete={({ eventRecords }: any) => {
            eventRecords.forEach((r: any) => handlersRef.current.onUnschedule(r.disputeId));
            return false;
          }}
          onEventSelectionChange={({ selected }: any) => handlersRef.current.onSelect(selected?.[0]?.disputeId ?? null)}
          onEventKeyDown={({ eventRecord, event }: any) => {
            if (event.key === "o" || event.key === "O") handlersRef.current.onOpen(eventRecord.disputeId);
          }}
        />
      </div>

      <aside
        className="desk-unscheduled flex w-full shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface xl:h-[var(--board-h)] xl:w-[310px]"
        style={{ "--board-h": `${40 + team.length * 64 + 16}px` } as React.CSSProperties}
        aria-label="Unscheduled disputes"
        data-testid="unscheduled-panel"
      >
        <div className="border-b border-line bg-missing-tint px-4 py-2.5">
          <h2 className="text-[15px] font-bold text-missing">Unscheduled ({unscheduledRows.length})</h2>
          <p className="text-[12.5px] text-missing">A deadline but no time booked. Drag onto a row, or let Marlow book them.</p>
        </div>
        {/* Beside the board the list is as tall as the board and scrolls; below it, it grows with its rows. */}
        <div
          className="h-[var(--grid-h)] xl:h-auto xl:min-h-0 xl:flex-1"
          style={{ "--grid-h": `${unscheduledRows.length ? Math.min(380, 44 + unscheduledRows.length * 60) : 0}px` } as React.CSSProperties}
        >
          <BryntumGrid
            ref={gridRef}
            data={unscheduledRows}
            rowHeight={60}
            hideHeaders
            emptyText=""
            cellMenuFeature={false}
            headerMenuFeature={false}
            cellEditFeature={false}
            sortFeature={false}
            columns={[
              {
                field: "customer",
                flex: 1,
                htmlEncode: false,
                renderer: ({ record }: any) =>
                  `<div class="desk-urow" data-dispute="${enc(record.disputeId)}"><b>${enc(record.customer)}</b><span>${enc(record.line)}</span><span class="due">${enc(record.due)} · ${record.effort} min of work</span></div>`,
              } as any,
            ]}
            onCellDblClick={({ record }: any) => handlersRef.current.onOpen(record.disputeId)}
          />
        </div>
        {unscheduledRows.length === 0 && (
          <p className="px-4 py-5 text-[13.5px] text-muted" data-testid="unscheduled-empty">Nothing waiting. Every dispute with a deadline has time booked.</p>
        )}
      </aside>
    </div>
  );
}

function hh(decimal: number): string {
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
