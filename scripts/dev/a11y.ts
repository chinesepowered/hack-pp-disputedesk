/**
 * Dev helper: run axe-core (WCAG 2.0, 2.1 and 2.2 A and AA rules) on the main screens of the
 * running app, at desktop and phone widths, and print what it finds.
 *   tsx scripts/dev/a11y.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const AXE = readFileSync(path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");

async function main() {
  const board = await (await fetch(`${BASE}/api/board`)).json();
  const cases: { disputeId: string; needsSeller: boolean; outcome: unknown }[] = board.board.cases;
  const open = cases.find((c) => c.needsSeller)?.disputeId;
  const done = cases.find((c) => c.outcome)?.disputeId;
  const pages = ["/", "/cases", ...(open ? [`/cases/${open}`] : []), ...(done ? [`/cases/${done}`] : []), "/prevention", "/settings", "/store"];

  const browser = await chromium.launch();
  let total = 0;
  for (const size of [
    { name: "desktop", width: 1440, height: 960 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, timezoneId: "America/Los_Angeles" });
    const page = await context.newPage();
    for (const p of pages) {
      await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(p === "/" ? 9000 : 6000);
      await page.locator('[data-testid="case-busy"]').waitFor({ state: "detached", timeout: 60_000 }).catch(() => undefined);
      await page.addScriptTag({ content: AXE });
      const result = await page.evaluate(async () => {
        const axe = (window as any).axe;
        const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
        return r.violations.map((v: any) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.slice(0, 4).map((n: any) => ({ target: String(n.target?.[0] ?? "").slice(0, 110), summary: String(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 220) })),
          count: v.nodes.length,
        }));
      });
      total += result.length;
      console.log(`${size.name} ${p}: ${result.length ? `${result.length} rule(s) failed` : "no violations"}`);
      for (const v of result) {
        console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.count} element${v.count === 1 ? "" : "s"})`);
        for (const n of v.nodes) console.log(`     ${n.target}\n       ${n.summary}`);
      }
    }
    await context.close();
  }
  await browser.close();
  console.log(total ? `\n${total} rule failure(s) in total.` : "\nNo violations on any page.");
}

main().catch((err) => {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
