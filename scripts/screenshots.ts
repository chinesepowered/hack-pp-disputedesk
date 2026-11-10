/**
 * pnpm screenshots: the README screenshots, 1440x960, into docs/screenshots/.
 *
 * Needs the app running (pnpm build && pnpm start, or pnpm dev) with disputes on the board.
 * Live screens are taken as they are. The drag picture is taken in Replay mode, where the
 * board belongs to this browser session only, so nothing on the live desk is moved.
 *
 *   pnpm screenshots            every screenshot
 *   pnpm screenshots board won  only the ones whose name contains one of these words
 */
import "./_env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "screenshots");
const SIZE = { width: 1440, height: 960 };

type Meta = { disputeId: string; needsSeller: boolean; stage: string | null; amount: number; recommendation: string | null; readiness: string | null; dueKind: string | null; outcome: { wonAmount: number } | null };

const json = async (pathname: string, init?: RequestInit) => (await fetch(`${BASE}${pathname}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } })).json() as Promise<any>;

async function newPage(browser: Browser, opts: { replay?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, timezoneId: "America/Los_Angeles", locale: "en-US", ignoreHTTPSErrors: true });
  if (opts.replay) await context.addCookies([{ name: "dd_mode", value: "replay", url: BASE }]);
  const page = await context.newPage();
  page.setDefaultTimeout(90_000);
  return page;
}

const quiet = async (page: Page) => {
  await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 120_000 }).catch(() => undefined);
  await page.locator('[data-testid^="toast-"]').first().waitFor({ state: "detached", timeout: 8000 }).catch(() => undefined);
};

async function board(page: Page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="recovered-amount"]').waitFor();
  await page.waitForSelector(".b-sch-event, .desk-unscheduled .b-grid-row", { timeout: 90_000 }).catch(() => undefined);
  // Marlow may be booking new or missed work: let it finish and the blocks settle.
  await page.waitForTimeout(7000);
  await page.locator('[data-testid^="toast-"]').first().waitFor({ state: "detached", timeout: 8000 }).catch(() => undefined);
}

async function main() {
  const only = process.argv.slice(2);
  const wanted = (name: string) => !only.length || only.some((w) => name.includes(w));
  mkdirSync(OUT, { recursive: true });
  const save = async (page: Page, name: string) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`saved docs/screenshots/${name}.png`);
  };

  const first = await json("/api/board");
  const cases: Meta[] = first.board.cases;
  // The case file pictures use a claim with a PayPal deadline that the rules say to fight.
  const fightable = cases.filter((c) => c.needsSeller && c.stage === "CHARGEBACK" && c.recommendation === "fight" && c.readiness === "ready");
  const open = fightable.find((c) => c.dueKind === "paypal") ?? fightable[0] ?? cases.find((c) => c.needsSeller);
  const won = cases.find((c) => c.outcome && c.outcome.wonAmount >= c.amount);
  const settled = cases.find((c) => c.outcome && c.outcome.wonAmount > 0 && c.outcome.wonAmount < c.amount);
  const settings = await json("/api/settings");
  const autoSchedule = Boolean(settings.settings?.autoSchedule ?? settings.autoSchedule ?? true);

  // The PayPal JS SDK on the store page is loaded from PayPal, through the session proxy if there is one.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
  try {
    const page = await newPage(browser);

    if (wanted("01-triage-board")) {
      await board(page);
      await save(page, "01-triage-board");
    }

    if (wanted("02-drag-from-unscheduled") || wanted("11-replay-mode")) {
      // Replay, with auto-scheduling off for a moment so the recorded disputes wait in Unscheduled.
      await json("/api/settings", { method: "PUT", body: JSON.stringify({ autoSchedule: false }) });
      try {
        const replay = await newPage(browser, { replay: true });
        await board(replay);
        const row = replay.locator(".desk-unscheduled .b-grid-row").first();
        const from = await row.boundingBox();
        // The timeline rows are as wide as the whole week, so aim by the board's own box:
        // the first person's row, a little after the current time line.
        const lane = await replay.locator('[data-testid="scheduler"]').boundingBox();
        const nowLine = await replay.locator(".b-sch-current-time, .b-sch-line.b-sch-current-time").first().boundingBox().catch(() => null);
        if (wanted("02-drag-from-unscheduled") && from && lane) {
          const dropX = Math.min(lane.x + lane.width - 160, (nowLine?.x ?? lane.x + 420) + 150);
          await replay.mouse.move(from.x + 60, from.y + from.height / 2);
          await replay.mouse.down();
          await replay.mouse.move(from.x + 30, from.y + from.height / 2, { steps: 4 });
          await replay.mouse.move(dropX, lane.y + 40 + 32, { steps: 14 });
          await replay.waitForTimeout(500);
          await save(replay, "02-drag-from-unscheduled");
          await replay.mouse.up();
          await replay.waitForTimeout(2500);
        }
        if (wanted("11-replay-mode")) {
          const book = replay.locator('[data-testid="schedule-button"]');
          if (await book.isVisible().catch(() => false)) {
            await book.click();
            await replay.waitForTimeout(6000);
          }
          await replay.locator('[data-testid^="toast-"]').first().waitFor({ state: "detached", timeout: 8000 }).catch(() => undefined);
          // Park the pointer away from the board so no tooltip covers the picture.
          await replay.mouse.move(700, 930);
          await replay.waitForTimeout(1200);
          await save(replay, "11-replay-mode");
        }
        await replay.context().close();
      } finally {
        await json("/api/settings", { method: "PUT", body: JSON.stringify({ autoSchedule }) });
      }
    }

    if (open && (wanted("03-case-file") || wanted("04-evidence-and-actions") || wanted("10-under-the-hood"))) {
      await page.goto(`${BASE}/cases/${open.disputeId}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="recommendation"]').waitFor();
      await quiet(page);
      await page.waitForTimeout(800);
      if (wanted("03-case-file")) await save(page, "03-case-file");
      if (wanted("04-evidence-and-actions")) {
        await page.locator('[data-testid="actions-card"]').evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 420 }));
        await page.waitForTimeout(700);
        await save(page, "04-evidence-and-actions");
      }
      if (wanted("10-under-the-hood")) {
        await page.evaluate(() => window.scrollTo({ top: 0 }));
        await page.locator('[data-testid="hood-open"]').click();
        await page.locator('[data-testid="hood-drawer"]').waitFor();
        await page.waitForTimeout(600);
        await save(page, "10-under-the-hood");
        await page.locator('[data-testid="hood-close"]').click();
      }
    }

    if (open && wanted("05-evidence-pack")) {
      const pack = await newPage(browser);
      await pack.goto(`${BASE}/api/cases/${open.disputeId}/pack`, { waitUntil: "load" });
      await pack.waitForTimeout(1200);
      await save(pack, "05-evidence-pack");
      await pack.context().close();
    }

    if (won && wanted("06-won")) {
      await page.goto(`${BASE}/cases/${won.disputeId}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="outcome-banner"]').waitFor();
      await quiet(page);
      await page.waitForTimeout(600);
      await save(page, "06-won");
    } else if (wanted("06-won")) console.log("skipped 06-won: no case on the board has been won yet");

    if (settled && wanted("07-offer-settled")) {
      await page.goto(`${BASE}/cases/${settled.disputeId}`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="outcome-banner"]').waitFor();
      await quiet(page);
      await page.waitForTimeout(600);
      await save(page, "07-offer-settled");
    } else if (wanted("07-offer-settled")) console.log("skipped 07-offer-settled: no case on the board was settled by an offer yet");

    if (wanted("08-prevention")) {
      await page.goto(`${BASE}/prevention`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="prevention-card"]').first().waitFor({ timeout: 150_000 });
      await page.waitForTimeout(800);
      await save(page, "08-prevention");
    }

    if (wanted("09-settings")) {
      await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="rules-example"]').waitFor();
      await page.waitForTimeout(600);
      await save(page, "09-settings");
    }

    if (wanted("12-demo-store")) {
      await page.goto(`${BASE}/store`, { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="paypal-button"]').waitFor({ timeout: 60_000 }).catch(() => console.log("note: the PayPal button did not load (no network to PayPal?)"));
      await page.waitForTimeout(1500);
      await save(page, "12-demo-store");
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
