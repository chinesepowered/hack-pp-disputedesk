/**
 * One small persistence layer: JSON documents by key.
 *
 * - Development: files under .data/ (git-ignored).
 * - Hosted: Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
 *
 * PayPal stays the source of truth for money. This store only keeps PayPal ids plus the desk's
 * own working state (who is booked when, drafts, settings), and everything money-related is
 * re-read from PayPal before it is shown or acted on.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Resolved on every call so tests (and anything else) can point the store somewhere else. */
function dataDir(): string {
  return process.env.DISPUTEDESK_DATA_DIR || path.join(process.cwd(), ".data");
}
const BLOB_PREFIX = "disputedesk/";

type BlobAccess = "public" | "private";
let blobAccess: BlobAccess = process.env.BLOB_ACCESS === "public" ? "public" : "private";

function blobEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/.test(key)) throw new Error(`Invalid store key: ${key}`);
  return key.replace(/:/g, "__");
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

async function blobGet(key: string): Promise<string | null> {
  const { get } = await import("@vercel/blob");
  const pathname = `${BLOB_PREFIX}${safeKey(key)}.json`;
  const attempt = async (access: BlobAccess) => {
    const res = await get(pathname, { access, useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return await streamToText(res.stream);
  };
  try {
    return await attempt(blobAccess);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|404/i.test(message)) return null;
    // The store may have been created with the other access level. Try it once and remember.
    const other: BlobAccess = blobAccess === "private" ? "public" : "private";
    try {
      const text = await attempt(other);
      blobAccess = other;
      return text;
    } catch {
      return null;
    }
  }
}

async function blobPut(key: string, text: string): Promise<void> {
  const { put } = await import("@vercel/blob");
  const pathname = `${BLOB_PREFIX}${safeKey(key)}.json`;
  const attempt = (access: BlobAccess) =>
    put(pathname, text, {
      access,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
  try {
    await attempt(blobAccess);
  } catch {
    const other: BlobAccess = blobAccess === "private" ? "public" : "private";
    await attempt(other);
    blobAccess = other;
  }
}

async function blobDel(key: string): Promise<void> {
  const { del, head } = await import("@vercel/blob");
  const pathname = `${BLOB_PREFIX}${safeKey(key)}.json`;
  try {
    const meta = await head(pathname);
    await del(meta.url);
  } catch {
    // Already gone.
  }
}

async function blobList(prefix: string): Promise<string[]> {
  const { list } = await import("@vercel/blob");
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${BLOB_PREFIX}${safeKey(prefix)}`, cursor });
    for (const b of page.blobs) {
      out.push(b.pathname.slice(BLOB_PREFIX.length).replace(/\.json$/, "").replace(/__/g, ":"));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function filePath(key: string): string {
  return path.join(dataDir(), `${safeKey(key)}.json`);
}

export async function getDoc<T>(key: string): Promise<T | null> {
  try {
    const text = blobEnabled() ? await blobGet(key) : await fs.readFile(filePath(key), "utf8");
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export async function setDoc<T>(key: string, value: T): Promise<void> {
  const text = JSON.stringify(value, null, blobEnabled() ? 0 : 2);
  if (blobEnabled()) {
    await blobPut(key, text);
    return;
  }
  await fs.mkdir(dataDir(), { recursive: true });
  const target = filePath(key);
  // Unique per write: two writes of one key in the same millisecond must not share a file.
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, text, "utf8");
  await fs.rename(tmp, target);
}

export async function deleteDoc(key: string): Promise<void> {
  if (blobEnabled()) {
    await blobDel(key);
    return;
  }
  await fs.rm(filePath(key), { force: true });
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (blobEnabled()) return blobList(prefix);
  try {
    const files = await fs.readdir(dataDir());
    const safe = safeKey(prefix);
    return files
      .filter((f) => f.startsWith(safe) && f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, "").replace(/__/g, ":"));
  } catch {
    return [];
  }
}

const lockTails = new Map<string, Promise<void>>();
const heldLocks = new AsyncLocalStorage<Set<string>>();

/**
 * Run fn while holding a named lock, so a read, change and write of one document cannot
 * interleave with another in this process. Re-entrant: code already holding the lock runs
 * straight through. Server instances do not share it; across instances the last write wins,
 * which is why money actions also carry a PayPal-Request-Id and are re-read from PayPal.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const mine = heldLocks.getStore();
  if (mine?.has(name)) return fn();
  const previous = lockTails.get(name) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => gate);
  lockTails.set(name, tail);
  await previous;
  try {
    return await heldLocks.run(new Set([...(mine ?? []), name]), fn);
  } finally {
    release();
    if (lockTails.get(name) === tail) lockTails.delete(name);
  }
}

/** Read, change and write one document as one step. Callers keep the change short. */
export async function updateDoc<T>(key: string, fallback: T, change: (doc: T) => T | void | Promise<T | void>): Promise<T> {
  return withLock(`doc:${key}`, async () => {
    const current = (await getDoc<T>(key)) ?? fallback;
    const next = (await change(current)) ?? current;
    await setDoc(key, next);
    return next;
  });
}

export function storeBackend(): "blob" | "files" {
  return blobEnabled() ? "blob" : "files";
}
