/**
 * Scene recordings for the demo video: real runs of the app against the PayPal sandbox, driven
 * by Playwright and saved with recordVideo.
 *
 *   pnpm video record setup-board            prepare the desk so the hero case arrives as new
 *   pnpm video record s01-open s03-board     record scenes (one or more, in order)
 *
 * Which disputes play which part is set with HERO and OFFER (dispute ids) in the environment
 * or in .data/video.json. Filing scenes use a sandbox dispute up, so they are recorded once.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { acceptOffer, openBuyerSession } from "../lib/buyer";
import { BASE, caption, click, duration, moveTo, recorder, ROOT, scrollTo, sleep } from "./lib";
import { AUDIO } from "./lib";
import { SCENES } from "./scenes";

type Cast = { hero: string; offer: string };

function cast(): Cast {
  const file = path.join(ROOT, ".data", "video.json");
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Cast>) : {};
  const hero = process.env.HERO ?? saved.hero;
  const offer = process.env.OFFER ?? saved.offer;
  if (!hero || !offer) throw new Error("Set HERO and OFFER (dispute ids), or write them to .data/video.json.");
  return { hero, offer };
}

const api = async (pathname: string, init?: RequestInit) => {
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  return res.json() as Promise<any>;
};

/** How long a scene's picture has to last. */
function need(id: string): number {
  const scene = SCENES.find((s) => s.id === id)!;
  return 0.35 + duration(path.join(AUDIO, `${id}.mp3`)) + (scene.tail ?? 0.5);
}

const tag = (label: string, rest: string) => `<span class="tag">${label}</span>${rest}`;

/**
 * Which parts of a recording the edit keeps, as [from, to] ranges in seconds. Page loads are
 * skipped, and so are the minutes PayPal's sandbox takes to settle a case.
 */
function saveCuts(id: string, ranges: [number, number | null][]) {
  const file = path.join(ROOT, ".data", "video-cuts.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  all[id] = ranges.map(([a, b]) => [Math.round(a * 100) / 100, b === null ? null : Math.round(b * 100) / 100]);
  writeFileSync(file, JSON.stringify(all, null, 2));
}
const saveSkip = (id: string, seconds: number) => saveCuts(id, [[seconds, null]]);

/**
 * Desk state for the opening: every other case read and booked, the hero not seen yet, and
 * auto-scheduling off so it waits in the Unscheduled panel until Marlow is asked.
 */
async function setupBoard() {
  const { hero } = cast();
  const token = process.env.DEMO_ADMIN_TOKEN ?? "";
  console.log("Resetting the desk and re-reading PayPal...");
  await api("/api/admin/reset", { method: "POST", headers: { "x-admin-token": token } });
  const first = await api("/api/board");
  const todo = (first.board.cases as any[]).filter((c) => c.readiness === null && !c.outcome && c.disputeId !== hero);
  console.log(`Marlow reads ${todo.length} cases...`);
  for (const c of todo) await api(`/api/cases/${c.disputeId}/prepare`, { method: "POST", body: JSON.stringify({ explain: false, draft: false }) });
  await api("/api/board/schedule", { method: "POST", body: JSON.stringify({ reflow: true, explain: false }) });
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ autoSchedule: false }) });
  // Forget the hero so it arrives as a new dispute (local files only).
  const deskFile = path.join(ROOT, ".data", "desk.json");
  const desk = JSON.parse(readFileSync(deskFile, "utf8"));
  delete desk.cases[hero];
  desk.blocks = desk.blocks.filter((b: any) => b.disputeId !== hero);
  writeFileSync(deskFile, JSON.stringify(desk, null, 2));
  rmSync(path.join(ROOT, ".data", `case-${hero}.json`), { force: true });
  console.log(`Ready: ${desk.blocks.length} blocks booked, ${hero} will arrive as new.`);
}

async function s01Open() {
  const { hero } = cast();
  const total = need("s01-open");
  const r = await recorder("s01-open");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".b-sch-event");
  const row = page.locator(`.desk-urow[data-dispute="${hero}"]`);
  await row.waitFor({ state: "visible" });
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s01-open", start);
  await caption(page, tag("New PayPal claim", "$184 · item not received"));
  await page.mouse.move(1200, 520, { steps: 10 });
  await sleep(3200);
  await moveTo(page, row, { steps: 40 });
  await sleep(2600);
  await caption(page, tag("Deadline", "PayPal wants the seller's evidence by November 20"));
  await moveTo(page, page.locator('[data-testid="unscheduled-panel"] h2'), { steps: 20 });
  await sleep(Math.max(500, (total + 1.2) * 1000 - (Date.now() - t0 - start * 1000)));
  await r.finish();
}

async function s03Board() {
  const { hero } = cast();
  const total = need("s03-board");
  const r = await recorder("s03-board");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".b-sch-event");
  const button = page.locator('[data-testid="schedule-button"]');
  await button.waitFor({ state: "visible" });
  // Wait until Marlow has read the new case, so the block gets its colour.
  await page.waitForFunction(() => !document.querySelector('[data-testid="schedule-button"]')?.hasAttribute("disabled"));
  await sleep(500);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s03-board", start);
  const elapsed = () => (Date.now() - t0) / 1000 - start;

  await caption(page, tag("PayPal Disputes API", "<code>GET /v1/customer/disputes</code> then one <code>GET</code> per case"));
  await page.mouse.move(900, 300, { steps: 8 });
  await sleep(4200);
  await caption(page, tag("Marlow", "books each case into free time before its deadline"));
  await click(page, button);
  await page.locator(`.b-sch-event-wrap`).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid="marlow-note"]')?.textContent?.includes("booking"), null, { timeout: 30_000 }).catch(() => undefined);
  await sleep(Math.max(400, 10_800 - elapsed() * 1000));

  // Drag the hero's block to another person's row: Bryntum drag and drop, then Marlow reflows.
  await caption(page, tag("Bryntum Scheduler", "drag to reassign, resize to change effort, Marlow reflows the rest"));
  const block = page.locator(".b-sch-event").filter({ hasText: "Priya" }).first();
  const box = await block.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
    await sleep(300);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 64, { steps: 36 });
    await sleep(350);
    await page.mouse.up();
  }
  await sleep(2600);
  const moved = page.locator(".b-sch-event").filter({ hasText: "Priya" }).first();
  await moved.hover().catch(() => undefined);
  await sleep(Math.max(600, (total + 1.2) * 1000 - elapsed() * 1000));
  void hero;
  await r.finish();
}

async function s04Case() {
  const { hero } = cast();
  const total = need("s04-case");
  // Marlow builds the case before the camera rolls, so the scene shows the finished file.
  await api(`/api/cases/${hero}/prepare`, { method: "POST", body: JSON.stringify({ explain: true, draft: true }) });
  const r = await recorder("s04-case");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/cases/${hero}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="recommendation"]').waitFor();
  await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 90_000 }).catch(() => undefined);
  await sleep(700);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s04-case", start);
  const elapsed = () => (Date.now() - t0) / 1000 - start;
  const until = async (seconds: number) => sleep(Math.max(200, seconds * 1000 - elapsed() * 1000));

  await caption(page, tag("PayPal", "<code>GET /v2/checkout/orders/{id}</code> · <code>GET /v2/payments/captures/{id}</code> · tracking"));
  await page.mouse.move(520, 420, { steps: 12 });
  await until(2.2);
  await scrollTo(page, page.locator("#paypal-title"), 150);
  await moveTo(page, page.locator("#paypal-title"), { steps: 16 });
  await until(7.2);
  await caption(page, tag("Store records", "carrier scans, signature and the delivery photo"));
  await scrollTo(page, page.locator("#store-title"), 120);
  await until(10.5);
  await caption(page, tag("AI", "a vision model reads the delivery photo: a parcel at the door"));
  const photo = page.locator("figure").filter({ hasText: "Carrier delivery photo" }).first();
  await scrollTo(page, photo, 260);
  await moveTo(page, photo, { steps: 18 });
  await until(15.2);
  await caption(page, tag("Rules, not the model", "a fixed evidence table sets the 95% win estimate"));
  await scrollTo(page, page.locator('[data-testid="checklist"]'), 130);
  await moveTo(page, page.locator('[data-testid="rec-likelihood"]'), { steps: 22 });
  await until(21.0);
  await caption(page, tag("AI", "Marlow drafts the response and builds the evidence pack"));
  await scrollTo(page, page.locator('[data-testid="draft-card"]'), 140);
  await moveTo(page, page.locator('[data-testid="open-pack"]'), { steps: 18 });
  await until(total + 1.2);
  await r.finish();
}

async function s05File(id?: string) {
  const dispute = id ?? cast().hero;
  const total = need("s05-file");
  const r = await recorder("s05-file");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/cases/${dispute}`, { waitUntil: "domcontentloaded" });
  const approve = page.locator('[data-testid="file-evidence"]');
  await approve.waitFor();
  await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await scrollTo(page, page.locator('[data-testid="actions-card"]'), 330);
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s05-file", start);
  const elapsed = () => (Date.now() - t0) / 1000 - start;

  await caption(page, tag("PayPal Disputes API", "<code>POST /v1/customer/disputes/{id}/provide-evidence</code>"));
  await page.mouse.move(1500, 420, { steps: 8 });
  await sleep(500);
  await click(page, approve);
  await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 90_000 });
  console.log(`  filed after ${elapsed().toFixed(1)} s`);
  await sleep(1100);
  await caption(page, tag("Filed", "evidence pack PDF attached · PayPal is reviewing"));
  await scrollTo(page, page.locator('[data-testid="case-steps"]'), 260);
  await sleep(900);
  await click(page, page.locator('[data-testid="hood-open"]'));
  await sleep(Math.max(2200, (total + 1.5) * 1000 - elapsed() * 1000));
  await r.finish();
}

async function s06Settle() {
  const { hero } = cast();
  const total = need("s06-settle");
  const r = await recorder("s06-settle");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/cases/${hero}`, { waitUntil: "domcontentloaded" });
  const settle = page.locator('[data-testid="settle-seller"]');
  await settle.waitFor({ timeout: 60_000 });
  await scrollTo(page, page.locator('[data-testid="sandbox-tools"]'), 420);
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s06-settle", start);
  await caption(page, tag("Sandbox only", "<code>POST /v1/customer/disputes/{id}/adjudicate</code>"));
  await page.mouse.move(1500, 500, { steps: 8 });
  await sleep(1000);
  await click(page, settle);
  await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 90_000 });
  await sleep(2200);
  const settledAt = (Date.now() - t0) / 1000;
  // PayPal settles asynchronously (about two minutes). The wait is cut in the edit.
  await caption(page, null);
  await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 8 * 60_000 });
  const wonAt = (Date.now() - t0) / 1000;
  await scrollTo(page, page.locator('[data-testid="outcome-banner"]'), 200);
  await caption(page, tag("PayPal", "hold released · <code>RESOLVED_SELLER_FAVOUR</code>"));
  await moveTo(page, page.locator('[data-testid="outcome-title"]'), { steps: 20 });
  await sleep(3800);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="recovered-amount"]').waitFor();
  await page.waitForSelector(".b-sch-event").catch(() => undefined);
  await caption(page, tag("Recovered this month", "the counter goes up"));
  await moveTo(page, page.locator('[data-testid="recovered-amount"]'), { steps: 20 });
  await sleep(Math.max(2500, total * 1000 - 9000));
  saveCuts("s06-settle", [[start, settledAt], [wonAt - 0.2, null]]);
  console.log(`  settle clicked, won after ${(wonAt - settledAt).toFixed(0)} s (cut in the edit)`);
  await r.finish();
}

async function s07Offer() {
  const { offer } = cast();
  const total = need("s07-offer");
  // Marlow works the case with tools before the camera rolls, so a proposal is waiting.
  const before = await api(`/api/cases/${offer}`);
  if (!(before.detail?.proposals ?? []).some((p: any) => p.status === "pending" && p.action === "make_offer")) {
    await api("/api/agent/run", { method: "POST", body: JSON.stringify({ disputeId: offer, instruction: "Work this case and propose what the rules say." }) });
  }
  const r = await recorder("s07-offer");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/cases/${offer}`, { waitUntil: "domcontentloaded" });
  const approve = page.locator('[data-testid="proposal-approve"]');
  await approve.waitFor({ timeout: 120_000 });
  await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s07-offer", start);
  const elapsed = () => (Date.now() - t0) / 1000 - start;
  const until = async (seconds: number) => sleep(Math.max(200, seconds * 1000 - elapsed() * 1000));

  await caption(page, tag("Rules", "thin listing, no size chart: win estimate 45%, so offer"));
  await moveTo(page, page.locator('[data-testid="rec-action"]'), { steps: 16 });
  await until(5.6);
  await caption(page, tag("Agent tools", "<code>get_dispute</code> · <code>gather_evidence</code> · <code>make_offer</code>, checked in code"));
  await scrollTo(page, page.locator('[data-testid="ask-card"]'), 180);
  await moveTo(page, approve, { steps: 20 });
  await until(9.6);
  await caption(page, tag("PayPal Disputes API", "<code>POST /v1/customer/disputes/{id}/make-offer</code>"));
  await click(page, approve);
  await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 90_000 });
  await sleep(1800);
  const offeredAt = elapsed();

  // The buyer's side, in PayPal's own Resolution Center (a second browser, not recorded here).
  let accepted = false;
  for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
    const buyer = await openBuyerSession();
    try {
      await acceptOffer(buyer, offer);
      accepted = true;
    } catch (err) {
      console.log(`  buyer step failed (${err instanceof Error ? err.message.slice(0, 120) : err}), retrying`);
    } finally {
      await buyer.close();
    }
  }
  if (!accepted) {
    // Keep what was recorded: the offer itself is on film even if the buyer's side is not.
    saveCuts("s07-offer", [[start, null]]);
    await r.finish();
    throw new Error("The buyer could not accept the offer. Run pnpm buyer accept-offer by hand, then record the outcome.");
  }
  await caption(page, tag("Buyer", "accepts the offer in PayPal · PayPal refunds $31"));
  await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 10 * 60_000 });
  const doneAt = elapsed();
  await scrollTo(page, page.locator('[data-testid="outcome-banner"]'), 200);
  await moveTo(page, page.locator('[data-testid="outcome-title"]'), { steps: 18 });
  await sleep(4200);
  saveCuts("s07-offer", [[start, start + offeredAt + 0.4], [start + doneAt - 0.2, null]]);
  void total;
  console.log(`  offer filed at ${offeredAt.toFixed(1)} s, resolved at ${doneAt.toFixed(1)} s (the wait is cut in the edit)`);
  await r.finish();
}

/** The ending of the offer scene, recorded on its own: the resolved case as the desk shows it. */
async function s07End() {
  const { offer } = cast();
  const r = await recorder("s07-offer-end");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/cases/${offer}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 120_000 });
  await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await sleep(700);
  const start = (Date.now() - t0) / 1000;
  await caption(page, tag("Buyer", "accepts the offer in PayPal · PayPal refunds $31"));
  await page.mouse.move(1300, 300, { steps: 8 });
  await sleep(1200);
  await moveTo(page, page.locator('[data-testid="outcome-title"]'), { steps: 22 });
  await sleep(3000);
  await caption(page, tag("Resolved", "half the sale kept, no claim, no dispute fee"));
  await moveTo(page, page.locator('[data-testid="fund-movements"]').first(), { steps: 18 });
  await sleep(4500);
  // The first part of the scene keeps the approval; the long wait on PayPal is dropped.
  const file = path.join(ROOT, ".data", "video-cuts.json");
  const all = JSON.parse(readFileSync(file, "utf8"));
  const first = all["s07-offer"]?.[0] ?? [0, 20];
  all["s07-offer"] = [[first[0], first[0] + 11.2], [first[0] + 15.2, first[1] ?? first[0] + 17.7], [Math.round(start * 100) / 100, null, "s07-offer-end"]];
  writeFileSync(file, JSON.stringify(all, null, 2));
  await r.finish();
}

async function s08Prevent() {
  const total = need("s08-prevent");
  await api("/api/prevention");
  const r = await recorder("s08-prevent");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/prevention`, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="prevention-card"]').filter({ hasText: "Planter" }).first();
  await card.waitFor({ timeout: 120_000 });
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s08-prevent", start);
  await caption(page, tag("AI", "patterns are counted in code, the model writes the card"));
  await page.mouse.move(700, 300, { steps: 8 });
  await sleep(1800);
  await moveTo(page, card.locator("h2"), { steps: 24 });
  await sleep(2200);
  await card.locator("summary").click().catch(() => undefined);
  await moveTo(page, card.locator("text=Suggested fix").first(), { steps: 16 });
  await sleep(Math.max(1500, (total + 1.2) * 1000 - (Date.now() - t0 - start * 1000)));
  await r.finish();
}

async function s09Guard(id?: string) {
  // An open case shows real action buttons; the hero is settled by this point in the video.
  const hero = id ?? cast().hero;
  const total = need("s09-guard");
  const r = await recorder("s09-guard");
  const { page } = r;
  const t0 = Date.now();
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="rules-example"]').waitFor();
  await sleep(600);
  const start = (Date.now() - t0) / 1000;
  saveSkip("s09-guard", start);
  const elapsed = () => (Date.now() - t0) / 1000 - start;
  const until = async (seconds: number) => sleep(Math.max(200, seconds * 1000 - elapsed() * 1000));

  await caption(page, tag("Guardrails", "the owner's thresholds are checked in code before PayPal is called"));
  await moveTo(page, page.locator('[data-testid="auto-accept-under"]'), { steps: 20 });
  await until(3.4);
  await moveTo(page, page.locator('[data-testid="always-ask-above"]'), { steps: 20 });
  await until(6.2);
  // The case file: only actions PayPal lists, each with its endpoint.
  await page.goto(`${BASE}/cases/${hero}`, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="allowed-actions"]').waitFor();
  await caption(page, tag("PayPal decides", "only actions in the dispute's <code>links</code> get a button"));
  await moveTo(page, page.locator('[data-testid="allowed-actions"]'), { steps: 18 });
  await until(10.6);
  await click(page, page.locator('[data-testid="hood-open"]'));
  await caption(page, tag("Under the hood", "every PayPal call, with its PayPal-Debug-Id"));
  await until(14.4);
  await caption(page, tag("One honest limit", "the win estimate is rule based, and sandbox waits were cut from this video"));
  await until(total + 1.2);
  await r.finish();
}

const REGISTRY: Record<string, (arg?: string) => Promise<void>> = {
  "setup-board": setupBoard,
  "s01-open": s01Open,
  "s03-board": s03Board,
  "s04-case": s04Case,
  "s05-file": s05File,
  "s06-settle": s06Settle,
  "s07-offer": s07Offer,
  "s07-end": s07End,
  "s08-prevent": s08Prevent,
  "s09-guard": s09Guard,
};

export async function recordScenes(ids: string[]) {
  if (!ids.length) {
    console.log(`Scenes: ${Object.keys(REGISTRY).join(", ")}`);
    return;
  }
  for (const raw of ids) {
    const [id, arg] = raw.split("=");
    const run = REGISTRY[id];
    if (!run) throw new Error(`Unknown scene ${id}.`);
    console.log(`Recording ${id}...`);
    await run(arg);
    console.log(`  done: ${id}`);
  }
}
