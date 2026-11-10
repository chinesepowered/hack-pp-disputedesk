/**
 * Title, caption and end cards for the video, plus the thumbnail. Rendered from HTML with
 * headless Chromium. Marlow is the same SVG component the app uses.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { Marlow } from "@/components/marlow/Marlow";
import { CARDS, ensureDirs, ROOT } from "./lib";

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const marlow = (mood: "calm" | "working" | "success" | "empty", size: number) => renderToStaticMarkup(<Marlow mood={mood} size={size} />);

const base = (body: string, bg: string, color: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; }
  body { font-family: ${FONT}; background: ${bg}; color: ${color}; display: flex; align-items: center; justify-content: center; }
</style></head><body>${body}</body></html>`;

const problem = base(
  `<div style="display:flex;align-items:center;gap:90px;width:1620px">
     <div style="flex:1">
       <div style="font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2f5d4a">For PayPal sellers with 1 to 10 staff</div>
       <h1 style="font-size:92px;line-height:1.04;font-weight:800;letter-spacing:-.02em;margin-top:22px">Small sellers lose disputes they could win.</h1>
       <ul style="list-style:none;padding:0;margin-top:46px;display:grid;gap:22px;font-size:42px;font-weight:600">
         <li style="display:flex;gap:22px;align-items:center"><span style="width:20px;height:20px;border-radius:50%;background:#b3402e;flex:none"></span>Nobody owns them</li>
         <li style="display:flex;gap:22px;align-items:center"><span style="width:20px;height:20px;border-radius:50%;background:#b3402e;flex:none"></span>The deadline slips</li>
         <li style="display:flex;gap:22px;align-items:center"><span style="width:20px;height:20px;border-radius:50%;background:#b3402e;flex:none"></span>The wrong evidence goes in</li>
       </ul>
       <p style="margin-top:44px;font-size:38px;color:#55625b">A lost claim can cost the sale, the goods and a dispute fee.</p>
     </div>
     <div style="flex:none">${marlow("calm", 440)}</div>
   </div>`,
  "#f7f5ef",
  "#1f2a24",
);

const end = base(
  `<div style="text-align:center;width:1500px">
     <div style="display:flex;justify-content:center">${marlow("success", 330)}</div>
     <h1 style="font-size:128px;font-weight:800;letter-spacing:-.03em;margin-top:8px">Dispute Desk</h1>
     <p style="font-size:46px;margin-top:10px;color:#dcebe3">Marlow keeps calm when a chargeback lands.</p>
     <p style="font-size:28px;margin-top:54px;color:#bcd6c9;line-height:1.6">PayPal Disputes API · Orders and Payments (server SDK) · Agent Toolkit · JS SDK v6 · Webhooks<br>Bryntum Scheduler · APIMatic PayPal SDK and Context Plugin · open models on W&amp;B Inference</p>
     <p style="font-size:24px;margin-top:30px;color:#9fc0b1">PayPal sandbox only. No real money moves. Open source under AGPL-3.0.</p>
   </div>`,
  "#24493a",
  "#ffffff",
);

const thumb = base(
  `<div style="display:flex;align-items:center;gap:44px;width:1080px">
     <div style="flex:none">${marlow("success", 330)}</div>
     <div>
       <h1 style="font-size:104px;font-weight:800;letter-spacing:-.03em;line-height:1">Dispute Desk</h1>
       <p style="font-size:38px;margin-top:20px;line-height:1.25;color:#dcebe3">An AI dispute and chargeback desk for small PayPal sellers</p>
       <div style="margin-top:30px;display:inline-block;background:#e0f1e7;color:#1e5c41;font-weight:800;font-size:36px;border-radius:16px;padding:12px 24px">Won, $184 recovered</div>
     </div>
   </div>`,
  "#24493a",
  "#ffffff",
);

export async function renderCards() {
  ensureDirs();
  const browser = await chromium.launch();
  const shoot = async (html: string, file: string, width: number, height: number) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: file });
    await page.close();
  };
  await shoot(problem, path.join(CARDS, "s02-problem.png"), 1920, 1080);
  await shoot(end, path.join(CARDS, "s10-end.png"), 1920, 1080);
  await shoot(thumb, path.join(ROOT, "demo", "thumb.png"), 1200, 800);
  await browser.close();
  writeFileSync(path.join(CARDS, "README.txt"), "Rendered by scripts/video/cards.tsx\n");
  console.log("Cards rendered: s02-problem.png, s10-end.png, demo/thumb.png");
}
