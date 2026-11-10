/** Dev helper: exercise the Scheduler interactions (drag from grid, reassign, resize, editor). */
import { chromium } from "playwright";

async function main() {
  const base = "http://localhost:3000";
  // Start from a board with auto-scheduling off and one dispute unscheduled.
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoSchedule: false }) });
  const board = (await (await fetch(`${base}/api/board`)).json()).board;
  const victim = board.blocks[0]?.disputeId;
  if (victim) await fetch(`${base}/api/board/blocks?disputeId=${victim}`, { method: "DELETE" });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: "America/Los_Angeles" })).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".b-sch-event", { timeout: 60000 });
  await page.waitForTimeout(2500);
  const count = async () => page.locator(".b-sch-event").count();
  console.log("events before:", await count(), "| unscheduled rows:", await page.locator(".desk-unscheduled .b-grid-row").count());

  // 1. Drag a row from the Unscheduled grid onto Sam's row.
  const row = page.locator(".desk-unscheduled .b-grid-row").first();
  const rb = await row.boundingBox();
  const target = await page.locator(".b-timeline-subgrid .b-grid-row, .b-timeline-sub-grid .b-grid-row").first().boundingBox();
  console.log("row box", !!rb, "target box", !!target);
  if (rb && target) {
    await page.mouse.move(rb.x + 40, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + 20, rb.y + rb.height / 2, { steps: 4 });
    await page.mouse.move(target.x + 520, target.y + target.height / 2, { steps: 12 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: ".data/board-drag.png" });
    await page.mouse.up();
    await page.waitForTimeout(3500);
  }
  console.log("events after grid drop:", await count(), "| unscheduled rows:", await page.locator(".desk-unscheduled .b-grid-row").count(), "| note:", (await page.locator('[data-testid="marlow-note"]').innerText()).slice(0, 140));

  // 2. Drag an event to another row.
  const ev = page.locator(".b-sch-event").first();
  const eb = await ev.boundingBox();
  if (eb) {
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.mouse.move(eb.x + eb.width / 2 + 60, eb.y + eb.height / 2 + 64, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(3000);
  }
  console.log("after move note:", (await page.locator('[data-testid="marlow-note"]').innerText()).slice(0, 140));

  // 3. Tooltip.
  const ev2 = page.locator(".b-sch-event").nth(1);
  await ev2.hover();
  await page.waitForTimeout(1500);
  console.log("tooltip:", (await page.locator(".desk-tip").first().innerText().catch(() => "none")).replace(/\s+/g, " ").slice(0, 200));

  // 4. Editor on double click.
  await ev2.dblclick();
  await page.waitForTimeout(1200);
  console.log("editor open:", await page.locator(".b-eventeditor, .b-event-editor").count());
  await page.screenshot({ path: ".data/board-editor.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: ".data/board-after.png" });
  console.log("errors:", errors.length ? errors.slice(0, 5).join(" | ") : "none");
  await browser.close();
  await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoSchedule: true }) });
}
main().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
