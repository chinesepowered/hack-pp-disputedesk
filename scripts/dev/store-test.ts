/**
 * Dev helper: buy one item on the demo store page with the sandbox buyer, through the PayPal
 * JS SDK v6 button and PayPal's own approval window. Creates one real sandbox order.
 *   tsx scripts/dev/store-test.ts [sku]
 */
import "../_env";
import { openBuyerSession } from "../lib/buyer";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";

async function main() {
  const sku = process.argv[2];
  const buyer = await openBuyerSession();
  const { page, context } = buyer;
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  const calls: string[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/store/")) calls.push(`${r.request().method()} ${u.replace(BASE, "")} ${r.status()}`);
  });
  try {
    await page.goto(`${BASE}/store`, { waitUntil: "domcontentloaded" });
    if (sku) await page.locator(`[data-testid="product-${sku}"]`).click();
    const button = page.locator('[data-testid="paypal-button"]');
    await button.waitFor({ timeout: 60_000 });
    console.log("ok   JS SDK v6 rendered the PayPal button");
    const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 60_000 }), button.click()]);
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    console.log(`ok   approval window opened at ${new URL(popup.url()).host}`);
    const pay = popup.locator('[data-testid="submit-button-initial"]');
    for (let i = 0; i < 60 && !popup.isClosed(); i++) {
      if (await pay.isVisible().catch(() => false)) break;
      // Log in if PayPal asks (the saved buyer session usually skips this).
      const email = popup.locator("#email");
      if (await email.isVisible().catch(() => false)) {
        await email.fill(process.env.PAYPAL_SANDBOX_BUYER_EMAIL ?? "");
        await popup.locator("#btnNext").click().catch(() => undefined);
        await popup.waitForTimeout(1500);
      }
      const password = popup.locator("#password");
      if (await password.isVisible().catch(() => false)) {
        await password.fill(process.env.PAYPAL_SANDBOX_BUYER_PASSWORD ?? "");
        await popup.locator("#btnLogin").click().catch(() => undefined);
      }
      await popup.waitForTimeout(1000);
    }
    if (popup.isClosed() || !(await pay.isVisible().catch(() => false))) throw new Error("PayPal's approval window did not show a pay button.");
    await pay.click();
    console.log("ok   buyer approved in PayPal's window");
    await page.locator('[data-testid="store-paid"]').waitFor({ timeout: 90_000 });
    console.log(`ok   store page: ${(await page.locator('[data-testid="store-paid"]').textContent())?.replace(/\s+/g, " ").trim().slice(0, 220)}`);
  } finally {
    console.log(`calls: ${calls.join(" | ") || "none"}`);
    console.log(errors.length ? `console errors: ${errors.slice(0, 5).join(" || ")}` : "no console errors");
    await page.screenshot({ path: ".data/store-test.png" }).catch(() => undefined);
    await buyer.close();
  }
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
