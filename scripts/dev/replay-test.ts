/**
 * Dev helper: walk Replay mode in a real browser and report what happened.
 *   tsx scripts/dev/replay-test.ts [out-dir]
 * Switches to Replay with the header toggle, files the hero's evidence, settles it, sends the
 * planter offer and accepts the small claim, all from the recorded tape. Nothing reaches PayPal.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";

async function main() {
  const out = process.argv[2] ?? ".data/replay-test";
  mkdirSync(out, { recursive: true });
  const tape = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "replay", "tape.json"), "utf8"));
  const ids = Object.keys(tape.disputes);
  const withPost = (action: string) => ids.find((id) => tape.disputes[id].tape.some((i: any) => i.type === "post" && i.action === action));
  const hero = withPost("provide_evidence");
  const offer = withPost("make_offer");
  const accept = withPost("accept_claim");

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: "America/Los_Angeles", deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 240)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 240)}`));
  const step = (name: string, ok: boolean, detail = "") => console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  const text = async (testid: string) => (await page.locator(`[data-testid="${testid}"]`).first().textContent().catch(() => null))?.replace(/\s+/g, " ").trim() ?? null;
  const settle = async () => page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="mode-replay"]').click();
  await page.locator('[data-testid="replay-banner"]').waitFor();
  step("replay banner", true, await text("replay-banner") ?? "");
  await page.waitForSelector(".b-sch-event", { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  const cards = await page.locator('[data-testid^="case-card-"]').count();
  step("board lists the recorded cases", cards === ids.length, `${cards} cards, ${ids.length} on the tape, ${await page.locator(".b-sch-event").count()} blocks`);
  await page.screenshot({ path: path.join(out, "1-board.png") });

  if (hero) {
    await page.goto(`${BASE}/cases/${hero}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="file-evidence"]').waitFor();
    await settle();
    step("hero: replay hint", true, await text("replay-hint") ?? "(none)");
    step("hero: draft tag", true, (await text("draft-card"))?.slice(0, 90) ?? "");
    await page.locator('[data-testid="file-evidence"]').click();
    await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 60_000 });
    step("hero: evidence filed from the tape", true, await text("toast-success") ?? "");
    await page.screenshot({ path: path.join(out, "2-hero-filed.png") });
    await page.locator('[data-testid="settle-seller"]').waitFor({ timeout: 90_000 });
    step("hero: settle link appears by itself", true);
    await page.locator('[data-testid="settle-seller"]').click();
    await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 120_000 });
    step("hero: outcome", /Won/.test((await text("outcome-title")) ?? ""), await text("outcome-title") ?? "");
    await page.locator('[data-testid="outcome-banner"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, "3-hero-won.png") });
    // Something the tape does not hold: the app must refuse it plainly.
    await page.locator('[data-testid="hood-open"]').click();
    const rows = await page.locator('[data-testid="hood-row"]').count();
    step("under the hood shows replayed calls", rows > 3, `${rows} rows`);
    await page.screenshot({ path: path.join(out, "4-hood.png") });
    await page.locator('[data-testid="hood-close"]').click();
  }

  if (offer) {
    await page.goto(`${BASE}/cases/${offer}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="make-offer"]').waitFor();
    await settle();
    step("offer: recommendation", true, `${await text("rec-action")} at ${await text("rec-likelihood")}, amount field ${await page.locator('[data-testid="offer-amount"]').inputValue().catch(() => "?")}`);
    await page.locator('[data-testid="make-offer"]').click();
    await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 60_000 });
    step("offer: sent from the tape", true, await text("toast-success") ?? "");
    await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 120_000 });
    step("offer: outcome", true, await text("outcome-title") ?? "");
    await page.screenshot({ path: path.join(out, "5-offer-settled.png") });
  }

  if (accept) {
    await page.goto(`${BASE}/cases/${accept}`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="accept-claim"]').waitFor();
    await settle();
    await page.locator('[data-testid="accept-claim"]').click();
    const confirm = page.locator('[data-testid="accept-confirm"]');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.locator('[data-testid="toast-success"]').waitFor({ timeout: 60_000 });
    step("accept: sent from the tape", true, await text("toast-success") ?? "");
    await page.locator('[data-testid="outcome-banner"]').waitFor({ timeout: 120_000 });
    step("accept: outcome", true, await text("outcome-title") ?? "");
  }

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="recovered-amount"]').waitFor();
  await page.waitForTimeout(3000);
  step("board: recovered this month", true, `${await text("recovered-amount")} (${(await text("recovered-card"))?.slice(0, 80)})`);
  await page.screenshot({ path: path.join(out, "6-board-after.png") });

  await page.locator('[data-testid="replay-restart"]').click();
  await page.waitForTimeout(4000);
  step("restart: recovered resets", true, await text("recovered-amount") ?? "");

  await page.locator('[data-testid="mode-live"]').click();
  await page.waitForTimeout(3000);
  step("back to live", (await page.locator('[data-testid="replay-banner"]').count()) === 0);
  console.log(errors.length ? `console errors:\n  ${errors.slice(0, 8).join("\n  ")}` : "no console errors");
  await browser.close();
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
