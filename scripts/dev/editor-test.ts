import { chromium } from "playwright";
async function main() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, timezoneId: "America/Los_Angeles" })).newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 200), "\n", (e.stack ?? "").split("\n").slice(1, 9).map((l) => l.trim().slice(0, 150)).join("\n ")));
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".b-sch-event", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator(".b-sch-event").nth(1).dblclick();
  await page.waitForTimeout(1500);
  console.log("popups:", await page.locator(".b-popup").count(), "| editor:", await page.locator('[class*="eventeditor" i], [class*="event-editor" i]').count());
  await page.screenshot({ path: ".data/board-editor.png" });
  await browser.close();
}
main();
