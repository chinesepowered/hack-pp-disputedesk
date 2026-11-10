/**
 * Records every PayPal call made while handling one request, so the UI can show them in the
 * "Under the hood" drawer: method, path, status, PayPal-Debug-Id and the feature that asked.
 *
 * Each API route runs inside runWithRecorder(); the calls are returned with the JSON response
 * and the browser keeps the running list for its own session.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type PayPalCall = {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  debugId: string | null;
  feature: string;
  ms: number;
  /** rest: plain REST with our OAuth helper. sdk: @paypal/paypal-server-sdk. toolkit: @paypal/agent-toolkit. */
  via: "rest" | "sdk" | "toolkit";
  /** True when the response came from a recorded fixture (Replay mode), not a live call. */
  replay?: boolean;
  requestId?: string;
};

export type Mode = "live" | "replay";

type Context = {
  calls: PayPalCall[];
  feature: string;
  mode: Mode;
  sessionId: string;
};

const storage = new AsyncLocalStorage<Context>();

/** Calls made outside a request (scripts such as the seed) land here. */
const loose: PayPalCall[] = [];

export function currentContext(): Context | undefined {
  return storage.getStore();
}

export function currentMode(): Mode {
  return storage.getStore()?.mode ?? "live";
}

export function currentSessionId(): string {
  return storage.getStore()?.sessionId ?? "script";
}

export function currentFeature(): string {
  return storage.getStore()?.feature ?? "script";
}

export async function runWithRecorder<T>(
  init: { feature: string; mode?: Mode; sessionId?: string },
  fn: () => Promise<T>,
): Promise<{ result: T; calls: PayPalCall[] }> {
  const ctx: Context = {
    calls: [],
    feature: init.feature,
    mode: init.mode ?? "live",
    sessionId: init.sessionId ?? "anon",
  };
  const result = await storage.run(ctx, fn);
  return { result, calls: ctx.calls };
}

/** Run part of a request under a more specific feature label. */
export async function withFeature<T>(feature: string, fn: () => Promise<T>): Promise<T> {
  const ctx = storage.getStore();
  if (!ctx) return fn();
  const previous = ctx.feature;
  ctx.feature = feature;
  try {
    return await fn();
  } finally {
    ctx.feature = previous;
  }
}

export function recordCall(call: Omit<PayPalCall, "id" | "at" | "feature"> & { feature?: string }): PayPalCall {
  const ctx = storage.getStore();
  const full: PayPalCall = {
    ...call,
    id: randomUUID(),
    at: new Date().toISOString(),
    feature: call.feature ?? ctx?.feature ?? "script",
  } as PayPalCall;
  if (ctx) ctx.calls.push(full);
  else {
    loose.push(full);
    if (loose.length > 500) loose.shift();
  }
  return full;
}

export function looseCalls(): PayPalCall[] {
  return loose;
}

/** Keep ids readable in the drawer but drop query-string noise and anything long. */
export function displayPath(url: string): string {
  let p = url.replace(/^https?:\/\/[^/]+/, "");
  if (p.length > 120) p = `${p.slice(0, 117)}...`;
  return p;
}
