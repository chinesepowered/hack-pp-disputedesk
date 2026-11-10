/**
 * Shared helpers for the demo video: a recording browser, an on-screen cursor and caption bar
 * (headless recordings show no pointer), ffmpeg and ffprobe wrappers.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

export const ROOT = process.cwd();
export const RAW = path.join(ROOT, "demo", "raw");
export const CLIPS = path.join(RAW, "clips");
export const AUDIO = path.join(RAW, "audio");
export const CARDS = path.join(RAW, "cards");
export const SEGMENTS = path.join(RAW, "segments");
export const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
export const SIZE = { width: 1920, height: 1080 };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ensureDirs() {
  for (const d of [RAW, CLIPS, AUDIO, CARDS, SEGMENTS]) mkdirSync(d, { recursive: true });
}

export function ffmpeg(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

export function duration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]).toString().trim();
  return Number(out);
}

/** Runs in the page: a pointer that follows the mouse, a click ripple and a caption bar. */
const OVERLAY = `
(() => {
  const install = () => {
  if (window.__demo) return true;
  // An init script can run before <html> exists.
  if (!document.documentElement) return false;
  const css = document.createElement('style');
  css.textContent = \`
    #demo-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; z-index: 2147483647; pointer-events: none; transform: translate(-200px,-200px); transition: transform 60ms linear; }
    #demo-ripple { position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #2f5d4a; z-index: 2147483646; pointer-events: none; opacity: 0; }
    #demo-ripple.go { animation: demo-ripple 520ms ease-out; }
    @keyframes demo-ripple { 0% { opacity: .9; transform: translate(var(--x), var(--y)) scale(.3); } 100% { opacity: 0; transform: translate(var(--x), var(--y)) scale(1.5); } }
    #demo-caption { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); max-width: 1500px; z-index: 2147483645; pointer-events: none; background: rgba(24,32,28,.93); color: #fff; font: 600 25px/1.35 ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif; padding: 14px 26px; border-radius: 16px; box-shadow: 0 10px 34px rgba(0,0,0,.35); opacity: 0; transition: opacity 280ms ease; text-align: center; }
    #demo-caption.on { opacity: 1; }
    #demo-caption code { font: 600 22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #bfe5d3; }
    #demo-caption .tag { display: inline-block; background: #2f5d4a; border-radius: 8px; padding: 1px 10px; margin-right: 10px; font-size: 20px; letter-spacing: .02em; }
  \`;
  document.documentElement.appendChild(css);
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2 L4 20 L9 15.5 L12.2 22.5 L15 21.2 L11.8 14.4 L18.5 14.4 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ripple = document.createElement('div');
  ripple.id = 'demo-ripple';
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  // Mounted on <html>, outside <body>, so the app's own rendering never removes them.
  const mount = () => { for (const el of [cursor, ripple, caption]) if (!el.isConnected) document.documentElement.appendChild(el); };
  mount();
  document.addEventListener('DOMContentLoaded', mount);
  setInterval(mount, 500);
  const z = () => Number(getComputedStyle(document.body).zoom || 1) || 1;
  window.addEventListener('mousemove', (e) => { cursor.style.transform = 'translate(' + (e.clientX / 1) + 'px,' + (e.clientY / 1) + 'px)'; }, true);
  window.addEventListener('mousedown', (e) => {
    ripple.style.setProperty('--x', e.clientX + 'px'); ripple.style.setProperty('--y', e.clientY + 'px');
    ripple.classList.remove('go'); void ripple.offsetWidth; ripple.classList.add('go');
  }, true);
  window.__demo = {
    caption(html) { if (!html) { caption.classList.remove('on'); return; } caption.innerHTML = html; caption.classList.add('on'); },
    zoom: z,
  };
  return true;
  };
  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 25);
    document.addEventListener('DOMContentLoaded', install);
  }
})();
`;

export type Recorder = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Closes the context and returns the path of the saved clip. */
  finish: () => Promise<string>;
};

export async function recorder(scene: string, opts: { storageState?: string; proxy?: boolean; cookies?: { name: string; value: string }[] } = {}): Promise<Recorder> {
  ensureDirs();
  const dir = path.join(CLIPS, `_${scene}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const proxy = opts.proxy ? process.env.HTTPS_PROXY || process.env.https_proxy : undefined;
  const browser = await chromium.launch({ ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}) });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    recordVideo: { dir, size: SIZE },
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  if (opts.cookies?.length) {
    await context.addCookies(opts.cookies.map((c) => ({ ...c, url: BASE })));
  }
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const finish = async () => {
    await context.close();
    await browser.close();
    const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
    if (!file) throw new Error(`No recording was saved for ${scene}.`);
    const out = path.join(CLIPS, `${scene}.webm`);
    renameSync(path.join(dir, file), out);
    rmSync(dir, { recursive: true, force: true });
    return out;
  };
  return { browser, context, page, finish };
}

export async function caption(page: Page, html: string | null) {
  await page.evaluate((h) => (window as any).__demo?.caption(h), html).catch(() => undefined);
}

/** Move the pointer to an element along a smooth path, the way a person would. */
export async function moveTo(page: Page, target: Locator, opts: { dx?: number; dy?: number; steps?: number } = {}) {
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await target.boundingBox();
  if (!box) throw new Error("Target is not visible.");
  const x = box.x + (opts.dx ?? box.width / 2);
  const y = box.y + (opts.dy ?? box.height / 2);
  await page.mouse.move(x, y, { steps: opts.steps ?? 28 });
  await sleep(220);
  return { x, y };
}

export async function click(page: Page, target: Locator, opts: { dx?: number; dy?: number } = {}) {
  await moveTo(page, target, opts);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(250);
}

/** Smooth scroll so the recording does not jump. */
export async function scrollTo(page: Page, target: Locator, offset = 140) {
  await target.evaluate((el, off) => {
    const top = el.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top, behavior: "smooth" });
  }, offset);
  await sleep(900);
}

export function exists(file: string) {
  return existsSync(file);
}
