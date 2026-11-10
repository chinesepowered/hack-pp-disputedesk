/**
 * Sandbox buyer automation for `pnpm seed`: Playwright drives PayPal's own sandbox pages as the
 * buyer to approve payments and open disputes ("Report a problem"). Sandbox only.
 *
 * What was learned building this is in docs/build-log.md. If PayPal changes these pages, the
 * fallback is docs/seed-disputes-by-hand.md.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const WEB = "https://www.sandbox.paypal.com";
const STATE_FILE = path.join(process.cwd(), ".data", "buyer-session.json");
const SHOT_DIR = path.join(process.cwd(), ".data", "seed-shots");

export type BuyerSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

export type DisputeReasonKey = "not_received" | "not_as_described" | "unauthorized";

function log(...args: unknown[]) {
  console.log("   [buyer]", ...args);
}

export async function openBuyerSession(opts: { headless?: boolean } = {}): Promise<BuyerSession> {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  mkdirSync(SHOT_DIR, { recursive: true });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    headless: opts.headless ?? true,
    ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}),
  });
  let storageState: string | undefined;
  try {
    const fs = await import("node:fs");
    if (fs.existsSync(STATE_FILE)) storageState = STATE_FILE;
  } catch {
    storageState = undefined;
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    locale: "en-US",
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const close = async () => {
    await context.storageState({ path: STATE_FILE }).catch(() => undefined);
    await browser.close();
  };
  return { browser, context, page, close };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${Date.now()}-${name}.png`) }).catch(() => undefined);
}

/** Logs in when PayPal shows its login form. Returns true if a login happened. */
async function loginIfNeeded(page: Page): Promise<boolean> {
  const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL ?? "";
  const password = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD ?? "";
  const emailVisible = await page.locator("#email").isVisible().catch(() => false);
  const passwordVisible = await page.locator("#password").isVisible().catch(() => false);
  if (!emailVisible && !passwordVisible) return false;
  if (!email || !password) throw new Error("PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD are not set.");
  if (emailVisible) {
    await page.fill("#email", email);
    if (!(await page.locator("#password").isVisible().catch(() => false))) {
      await page.click("#btnNext");
    }
  }
  await page.waitForSelector("#password", { state: "visible", timeout: 20_000 });
  await page.fill("#password", password);
  await page.click("#btnLogin");
  await page.waitForTimeout(6000);
  if (await page.locator("#password").isVisible().catch(() => false)) {
    await shot(page, "login-stuck");
    throw new Error("Buyer login did not complete (captcha or wrong password). See .data/seed-shots/.");
  }
  return true;
}

/**
 * Approves a PayPal order as the buyer: opens the payer-action link, logs in if needed,
 * presses "Complete Purchase" and waits for the redirect back to returnUrlPrefix.
 */
export async function approveOrder(session: BuyerSession, approveUrl: string, returnUrlPrefix: string): Promise<void> {
  const { page } = session;
  await page.goto(approveUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const submit = page.locator('[data-testid="submit-button-initial"]');
  for (let i = 0; i < 40; i++) {
    if (await submit.isVisible().catch(() => false)) break;
    if (await loginIfNeeded(page)) continue;
    await page.waitForTimeout(1000);
  }
  if (!(await submit.isVisible().catch(() => false))) {
    await shot(page, "approve-no-button");
    throw new Error("PayPal's review page did not show a pay button.");
  }
  await submit.click();
  // PayPal sometimes shows a second confirmation step.
  const escaped = returnUrlPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    await page.waitForURL(new RegExp(`^${escaped}`), { timeout: 45_000 });
  } catch {
    const again = page.locator('[data-testid="submit-button-initial"], #payment-submit-btn');
    if (await again.first().isVisible().catch(() => false)) {
      await again.first().click();
      await page.waitForURL(new RegExp(`^${escaped}`), { timeout: 45_000 });
    } else {
      await shot(page, "approve-no-return");
      throw new Error("PayPal did not redirect back after approval.");
    }
  }
}

/**
 * Finds the buyer-side transaction id for a payment by opening recent Activity rows and
 * matching the ship-to name shown in the details. (Buyer and seller transaction ids differ.)
 */
export async function findBuyerTransaction(session: BuyerSession, match: { shipToName: string; amount: string }): Promise<string> {
  const { page } = session;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${WEB}/myaccount/activities/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5000);
    if (await loginIfNeeded(page)) await page.waitForTimeout(3000);
    await page.locator("#acceptAllButton").click({ timeout: 1500 }).catch(() => undefined);
    const amountText = `$${Number(match.amount).toFixed(2)}`;
    const rows = page.getByText(amountText, { exact: false });
    const count = Math.min(await rows.count(), 8);
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click().catch(() => undefined);
      await page.waitForTimeout(2500);
      const text = await page.locator("body").innerText();
      const idx = text.indexOf(match.shipToName);
      if (idx >= 0) {
        // The expanded details list "Transaction ID" followed by the id.
        const after = text.slice(Math.max(0, idx - 1500), idx + 1500);
        const m = after.match(/Transaction ID\s+([A-Z0-9]{17})/);
        if (m) return m[1];
      }
      // Collapse before trying the next row.
      await rows.nth(i).click().catch(() => undefined);
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(4000);
  }
  await shot(page, "activity-no-match");
  throw new Error(`Could not find the buyer transaction for ${match.shipToName} (${match.amount}).`);
}

/** A compact list of the visible form controls and validation messages, for error reports. */
async function describeForm(page: Page): Promise<string> {
  const items = await page.$$eval("input, select, textarea, button, [role=alert], [id^=errorMessage], [aria-invalid=true]", (els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => {
        const el = e as HTMLInputElement;
        const text = (el.innerText || "").replace(/\s+/g, " ").slice(0, 60);
        return `${el.tagName.toLowerCase()}[name=${el.name || ""} type=${el.type || ""} testid=${el.getAttribute("data-testid") || ""} value=${(el.value || "").slice(0, 30)} invalid=${el.getAttribute("aria-invalid") || ""}] ${text}`;
      }),
  );
  return items.filter((i) => !/header-|acceptAll|bannerClose/.test(i)).slice(0, 40).join(" ; ");
}

const ISSUE_BUTTON: Record<DisputeReasonKey, string> = {
  not_received: "elg-item-0",
  not_as_described: "elg-item-1",
  unauthorized: "elg-item-14",
};

const PREFERRED_RADIOS: Record<DisputeReasonKey, string[]> = {
  not_received: ["NOT_DELIVERED"],
  not_as_described: ["DIFFERENT_FROM_DESCRIPTION", "NOT_AS_DESCRIBED", "SIGNIFICANTLY_NOT_AS_DESCRIBED", "DAMAGED", "KEEP_ITEM", "NO_RETURN", "NO", "false"],
  unauthorized: [],
};

/**
 * Opens a dispute as the buyer through "Report a problem" and returns the PayPal case id
 * (PP-R-...). The form is a wizard whose steps differ by reason, so this walks it generically:
 * pick the issue, then on each step fill what is empty and press the primary button.
 */
export async function fileDispute(
  session: BuyerSession,
  input: { buyerTransactionId: string; reason: DisputeReasonKey; note: string; amount: string },
): Promise<string> {
  const { page } = session;
  const url = `${WEB}/resolutioncenter/filing/${input.buyerTransactionId}/create?type=PAYMENT`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6000);
  if (await loginIfNeeded(page)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(6000);
  }
  await page.locator("#acceptAllButton").click({ timeout: 1500 }).catch(() => undefined);

  // A half-finished filing from an earlier run: start over so the reason is right.
  const restart = page.locator('[data-testid="restart-filing"]');
  if (await restart.isVisible().catch(() => false)) {
    await restart.click();
    await page.getByRole("button", { name: /yes, start over/i }).click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
  }

  const issue = page.locator(`[data-testid="${ISSUE_BUTTON[input.reason]}"]`);
  await issue.waitFor({ state: "visible", timeout: 30_000 });
  await issue.click();
  await page.waitForTimeout(4000);

  let lastSignature = "";
  let stuck = 0;
  for (let step = 0; step < 16; step++) {
    if (/\/complete/.test(page.url())) break;
    const signature = (await page.locator("body").innerText()).slice(0, 2500);
    if (signature === lastSignature) {
      stuck++;
      if (stuck >= 2) break;
    } else stuck = 0;
    lastSignature = signature;

    // Native selects hidden behind custom dropdowns: choose a sensible option.
    for (const select of await page.locator("select").all()) {
      const value = await select.inputValue().catch(() => "");
      if (value) continue;
      const options = (await select.locator("option").allTextContents()).map((o) => o.trim());
      const want =
        ["Physical product", "Home"].find((w) => options.includes(w)) ??
        options.find((o) => o && !/^(item type|category|select)/i.test(o));
      if (want) await select.selectOption({ label: want }).catch(() => undefined);
      await page.waitForTimeout(500);
    }

    // Radio groups: prefer known values for this reason, else the first option.
    const groups = new Map<string, { id: string | null; value: string | null }[]>();
    for (const radio of await page.locator('input[type="radio"]').all()) {
      const name = (await radio.getAttribute("name")) ?? "";
      const entry = { id: await radio.getAttribute("id"), value: await radio.getAttribute("value") };
      groups.set(name, [...(groups.get(name) ?? []), entry]);
    }
    for (const [name, radios] of groups) {
      const anyChecked = await page.locator(`input[type="radio"][name="${name}"]:checked`).count();
      if (anyChecked) continue;
      const preferred = PREFERRED_RADIOS[input.reason];
      const wants = (r: { value: string | null }) => preferred.some((p) => p.toLowerCase() === (r.value ?? "").toLowerCase());
      const pick = radios.find(wants) ?? radios[0];
      if (!pick?.id) continue;
      const label = page.locator(`label[for="${pick.id}"]`).first();
      if (await label.count()) await label.click().catch(() => undefined);
      else await page.locator(`[id="${pick.id}"]`).click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(600);
    }

    // "When did it arrive?" style date fields: today, in PayPal's US Pacific calendar.
    const date = page.locator('input[name="dateSelector"]').first();
    // An untouched field holds its mask ("MM/DD/YYYY"), so "empty" means "no digits yet".
    if ((await date.isVisible().catch(() => false)) && !/\d/.test(await date.inputValue())) {
      const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date());
      await date.focus();
      await page.keyboard.type(today, { delay: 40 });
      await page.keyboard.press("Tab");
    }

    // Expected refund amount (the full payment).
    const refund = page.locator('input[name$="expected_refund"]').first();
    if ((await refund.isVisible().catch(() => false)) && !(await refund.inputValue())) {
      await refund.focus();
      await page.keyboard.type(Number(input.amount).toFixed(2), { delay: 50 });
      await page.keyboard.press("Tab");
    }

    // "Not as described" claims need at least 120 characters of comment, so pad short notes.
    const longNote =
      input.note.length >= 130
        ? input.note
        : `${input.note} I contacted the seller about this first and we could not agree on how to fix it, so I am asking PayPal to step in and help.`;
    for (const area of await page.locator("textarea").all()) {
      if ((await area.isVisible().catch(() => false)) && !(await area.inputValue())) {
        await area.fill(longNote);
      }
    }

    // Required text inputs we did not expect: give them the note so validation passes.
    for (const field of await page.locator('input[type="text"][aria-required="true"], input[type="text"][required]').all()) {
      if ((await field.isVisible().catch(() => false)) && !(await field.inputValue())) {
        await field.fill(input.note.slice(0, 60)).catch(() => undefined);
      }
    }

    for (const box of await page.locator('input[type="checkbox"]').all()) {
      if ((await box.isVisible().catch(() => false)) && !(await box.isChecked().catch(() => true))) {
        const id = await box.getAttribute("id");
        const label = id ? page.locator(`label[for="${id}"]`).first() : null;
        if (label && (await label.count())) await label.click().catch(() => undefined);
        else await box.check({ force: true }).catch(() => undefined);
      }
    }

    await page.waitForTimeout(500);
    const primary = page.locator('button[type="submit"]:visible').last();
    if (!(await primary.count())) break;
    await primary.click().catch(() => undefined);
    await page.waitForTimeout(5500);
  }

  if (!/\/complete/.test(page.url())) {
    await shot(page, `filing-stuck-${input.reason}`);
    const controls = await describeForm(page);
    throw new Error(`The dispute form did not reach its confirmation page. Controls on the last step: ${controls}`);
  }
  const done = await page.locator("body").innerText();
  const caseId = done.match(/PP-[A-Z]-[A-Z]{3}-\d+/)?.[0];
  if (!caseId) {
    await shot(page, "filing-no-case-id");
    throw new Error("Dispute filed but no case id was shown.");
  }
  log(`filed ${input.reason} as ${caseId}`);
  return caseId;
}

/**
 * Accepts the seller's offer as the buyer, in PayPal's Resolution Center. Used by
 * `pnpm buyer accept-offer <dispute-id>` to play the other side of an offer in a demo.
 */
export async function acceptOffer(session: BuyerSession, disputeId: string): Promise<string> {
  const { page } = session;
  const url = `${WEB}/resolutioncenter/${disputeId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6000);
  if (await loginIfNeeded(page)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(6000);
  }
  await page.locator("#acceptAllButton").click({ timeout: 1500 }).catch(() => undefined);
  const accept = page.locator('[data-testid="accept-offer"]');
  if (!(await accept.isVisible().catch(() => false))) {
    await shot(page, "no-offer");
    throw new Error("The buyer's case page shows no offer to accept (it can take a minute to appear after the seller sends it).");
  }
  await accept.click();
  await page.waitForTimeout(3000);
  // PayPal asks once more before closing the case.
  for (const name of [/^accept$/i, /accept offer/i, /confirm/i, /^yes/i]) {
    const confirm = page.getByRole("button", { name }).last();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click().catch(() => undefined);
      await page.waitForTimeout(3000);
      break;
    }
  }
  await page.waitForTimeout(4000);
  await shot(page, "offer-accepted");
  const stillOffered = await page.locator('[data-testid="accept-offer"]').isVisible().catch(() => false);
  if (stillOffered) throw new Error("The offer is still waiting on the buyer's page: PayPal did not take the acceptance.");
  const closed = "accepted";
  log(`offer on ${disputeId}: ${closed}`);
  return closed;
}
