/** Dev helper: screenshot a page of the running app and print console errors. */
import { chromium } from "playwright";

async function main() {
  const [path = "/", out = ".data/shot.png", waitMs = "6000", mode = "desktop"] = process.argv.slice(2);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: mode === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    timezoneId: "America/Los_Angeles",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForTimeout(Number(waitMs));
  await page.screenshot({ path: out, fullPage: mode === "full" || process.argv[6] === "full" });
  console.log("saved", out, "| errors:", errors.length ? errors.slice(0, 6).join("\n  ") : "none");
  await browser.close();
}
main();
