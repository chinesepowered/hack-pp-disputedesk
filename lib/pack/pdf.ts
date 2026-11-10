/**
 * Evidence pack PDF.
 *
 * Preferred: print the HTML pack with Playwright (headless Chromium), which is what runs
 * locally and in the seed and video scripts. Where no browser is available (a serverless
 * function on the hosted demo), the same content is laid out with pdf-lib instead, so filing
 * always has a real PDF to attach.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CaseDetail } from "@/lib/desk/types";
import { STORE } from "@/lib/shop/catalog";
import { packHtml, packModel, photoBytes } from "./html";

export type PackPdf = { bytes: Uint8Array; renderer: "playwright" | "pdf-lib" };

async function viaPlaywright(html: string): Promise<Uint8Array | null> {
  if (process.env.VERCEL || process.env.DISPUTEDESK_NO_BROWSER) return null;
  try {
    // Loaded by name at run time so the hosted build does not need a browser.
    const name = "playwright";
    const { chromium } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ name)) as typeof import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

const GREEN = rgb(0.184, 0.365, 0.29);
const INK = rgb(0.12, 0.16, 0.14);
const MUTED = rgb(0.36, 0.42, 0.39);

/** pdf-lib's standard fonts are WinAnsi only: replace what they cannot encode. */
function ansi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of ansi(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

async function viaPdfLib(detail: CaseDetail): Promise<Uint8Array> {
  const m = packModel(detail);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Evidence pack ${m.disputeId}`);
  pdf.setAuthor(STORE.name);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const W = 595;
  const H = 842;
  const M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const need = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    const x = opts.x ?? M;
    for (const line of wrap(s, font, size, opts.width ?? W - M - x)) {
      need(size + 4);
      page.drawText(line, { x, y: y - size, size, font, color: opts.color ?? INK });
      y -= size + (opts.gap ?? 3.5);
    }
  };
  const heading = (s: string) => {
    y -= 10;
    need(24);
    page.drawText(ansi(s.toUpperCase()), { x: M, y: y - 9, size: 9, font: bold, color: GREEN });
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.85, 0.83, 0.78) });
    y -= 7;
  };
  const row = (label: string, value: string, source?: string) => {
    const labelLines = wrap(label, bold, 9, 120);
    const valueLines = wrap(value, regular, 9.5, source ? 290 : 370);
    const h = Math.max(labelLines.length, valueLines.length) * 13 + 3;
    need(h);
    labelLines.forEach((l, i) => page.drawText(l, { x: M, y: y - 9 - i * 13, size: 9, font: bold, color: MUTED }));
    valueLines.forEach((l, i) => page.drawText(l, { x: M + 130, y: y - 9 - i * 13, size: 9.5, font: regular, color: INK }));
    if (source) page.drawText(ansi(source), { x: W - M - 70, y: y - 9, size: 8, font: regular, color: MUTED });
    y -= h;
  };

  page.drawText(ansi(STORE.name), { x: M, y: y - 18, size: 18, font: serif, color: GREEN });
  page.drawText(ansi(`Evidence pack, PayPal case ${m.disputeId}`), { x: W - M - 230, y: y - 10, size: 9, font: regular, color: MUTED });
  page.drawText(ansi(`${m.amount}, ${m.stage} stage`), { x: W - M - 230, y: y - 22, size: 9, font: regular, color: MUTED });
  y -= 30;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: GREEN });
  y -= 16;
  text(m.title, { font: bold, size: 13 });

  heading("Cover letter");
  text(m.letter || "No response drafted yet.", { font: serif, size: 10.5, gap: 4 });
  heading("Order");
  for (const f of m.facts) row(f.label, f.value);
  heading("Evidence summary");
  for (const c of m.checklist) row(c.label, c.detail, c.source);
  heading("Timeline");
  for (const t of m.timeline) row(t.at, t.text, t.source);
  if (m.tracking) {
    heading("Tracking");
    row("Carrier", `${m.tracking.carrier}, ${m.tracking.service}`);
    row("Tracking number", `${m.tracking.number} (on the PayPal order)`);
    if (m.tracking.signature) row("Signed for by", m.tracking.signature);
    for (const s of m.tracking.scans) row(s.at, s.text);
  }
  for (const p of m.photos) {
    const bytes = await photoBytes(p.file);
    if (!bytes) continue;
    try {
      const img = await pdf.embedJpg(bytes);
      const width = 300;
      const height = Math.min(230, (img.height / img.width) * width);
      heading(p.title);
      need(height + 30);
      page.drawImage(img, { x: M, y: y - height, width, height });
      y -= height + 6;
      text(p.caption, { size: 9, color: MUTED });
    } catch {
      // A photo that cannot be embedded is left out rather than failing the pack.
    }
  }
  if (m.thread.length) {
    heading("Messages with the customer");
    for (const t of m.thread) row(`${t.at} ${t.from}`, t.text);
  }
  if (m.policy.length) {
    heading("Return policy");
    for (const p of m.policy) text(`- ${p}`);
  }
  y -= 12;
  text(`Prepared by Dispute Desk for ${STORE.name}, ${STORE.city}. Sandbox demonstration: the shop, its customers and its carriers are fictional.`, { size: 8, color: MUTED });
  return await pdf.save();
}

export async function renderPackPdf(detail: CaseDetail): Promise<PackPdf> {
  const html = await packHtml(detail);
  const printed = await viaPlaywright(html);
  if (printed) return { bytes: printed, renderer: "playwright" };
  return { bytes: await viaPdfLib(detail), renderer: "pdf-lib" };
}
