/** The store's lock: concurrent changes to one document must all land. */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let store: typeof import("@/lib/store");

beforeAll(async () => {
  process.env.DISPUTEDESK_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "disputedesk-store-"));
  store = await import("@/lib/store");
});

describe("store", () => {
  it("keeps every change when many updates of one document run at once", async () => {
    await store.setDoc("counter", { n: 0, seen: [] as number[] });
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.updateDoc<{ n: number; seen: number[] }>("counter", { n: 0, seen: [] }, (doc) => {
          doc.n += 1;
          doc.seen.push(i);
        }),
      ),
    );
    const doc = await store.getDoc<{ n: number; seen: number[] }>("counter");
    expect(doc?.n).toBe(25);
    expect(new Set(doc?.seen).size).toBe(25);
  });

  it("writes the same key many times at once without a failed write", async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => store.setDoc("same-key", { i })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await store.getDoc<{ i: number }>("same-key")).not.toBeNull();
  });

  it("lets code that holds a lock take it again, and releases it after an error", async () => {
    const out = await store.withLock("a", () => store.withLock("a", async () => "inner"));
    expect(out).toBe("inner");
    await expect(store.withLock("a", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await store.withLock("a", async () => "after")).toBe("after");
  });
});
