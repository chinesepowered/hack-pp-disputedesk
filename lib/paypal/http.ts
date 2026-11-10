/**
 * Plain REST access to PayPal for the APIs the server SDK does not cover (Disputes, Webhooks).
 * One OAuth token helper, a PayPal-Request-Id on every POST, bounded retries with backoff,
 * and every call logged for the Under the hood drawer.
 */
import { randomUUID } from "node:crypto";
import { assertSandbox, env, PAYPAL_BASE_URL } from "@/lib/env";
import { currentMode, displayPath, recordCall } from "./log";

export class PayPalError extends Error {
  status: number;
  code: string;
  debugId: string | null;
  issue: string | null;
  details: unknown;
  /** True when no response arrived, so the outcome of a write is unknown rather than failed. */
  unknownOutcome: boolean;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    debugId?: string | null;
    issue?: string | null;
    details?: unknown;
    unknownOutcome?: boolean;
  }) {
    super(init.message);
    this.name = "PayPalError";
    this.status = init.status;
    this.code = init.code;
    this.debugId = init.debugId ?? null;
    this.issue = init.issue ?? null;
    this.details = init.details;
    this.unknownOutcome = init.unknownOutcome ?? false;
  }
}

type TokenState = { token: string; expiresAt: number };
let cached: TokenState | null = null;
let inflight: Promise<TokenState> | null = null;

async function fetchToken(): Promise<TokenState> {
  assertSandbox();
  if (!env.hasPayPal) {
    throw new PayPalError({
      status: 500,
      code: "MISSING_CREDENTIALS",
      message: "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set.",
    });
  }
  const started = Date.now();
  const basic = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const debugId = res.headers.get("paypal-debug-id");
  recordCall({
    method: "POST",
    path: "/v1/oauth2/token",
    status: res.status,
    debugId,
    ms: Date.now() - started,
    via: "rest",
    feature: "OAuth token (cached)",
  });
  if (!res.ok) {
    throw new PayPalError({
      status: res.status,
      code: "AUTH_FAILED",
      message: "PayPal refused the client credentials.",
      debugId,
    });
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh one minute early so a token never expires mid-request.
  return { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
}

export async function getAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = null;
    });
  }
  cached = await inflight;
  return cached.token;
}

export function forgetAccessToken(): void {
  cached = null;
}

export type PayPalRequest = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  /** A JSON body that is already serialized and must be sent byte for byte (webhook verification). */
  rawJson?: string;
  /** Multipart body, used by provide-evidence and the other document endpoints. */
  form?: () => FormData;
  feature?: string;
  /** Reused on retries so PayPal can deduplicate. Generated when absent on a POST. */
  requestId?: string;
  headers?: Record<string, string>;
};

export type PayPalResponse<T> = {
  data: T;
  status: number;
  debugId: string | null;
  requestId?: string;
};

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function paypalRequest<T = any>(req: PayPalRequest): Promise<PayPalResponse<T>> {
  if (currentMode() === "replay") {
    const { replayRequest } = await import("@/lib/replay/engine");
    return replayRequest<T>(req);
  }
  return liveRequest<T>(req);
}

export async function liveRequest<T = any>(req: PayPalRequest): Promise<PayPalResponse<T>> {
  const url = new URL(`${PAYPAL_BASE_URL}${req.path}`);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const requestId = req.method === "POST" ? (req.requestId ?? randomUUID()) : undefined;
  const shownPath = displayPath(url.toString());
  let lastError: PayPalError | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    const started = Date.now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      ...(req.headers ?? {}),
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    let body: BodyInit | undefined;
    if (req.form) {
      body = req.form(); // fetch sets the multipart boundary itself
    } else if (req.rawJson !== undefined) {
      headers["Content-Type"] = "application/json";
      body = req.rawJson;
    } else if (req.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(req.json);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      recordCall({
        method: req.method,
        path: shownPath,
        status: 0,
        debugId: null,
        ms: Date.now() - started,
        via: "rest",
        feature: req.feature,
        requestId,
      });
      lastError = new PayPalError({
        status: 0,
        code: "NO_RESPONSE",
        message: `No response from PayPal (${err instanceof Error ? err.message : "network error"}).`,
        unknownOutcome: req.method !== "GET",
      });
      continue;
    }

    const debugId = res.headers.get("paypal-debug-id");
    recordCall({
      method: req.method,
      path: shownPath,
      status: res.status,
      debugId,
      ms: Date.now() - started,
      via: "rest",
      feature: req.feature,
      requestId,
    });

    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }

    if (res.ok) return { data: data as T, status: res.status, debugId, requestId };

    if (res.status === 401 && attempt === 0) {
      forgetAccessToken();
      lastError = toError(res.status, data, debugId);
      continue;
    }
    lastError = toError(res.status, data, debugId);
    if (!RETRY_STATUS.has(res.status)) break;
  }
  throw lastError ?? new PayPalError({ status: 0, code: "NO_RESPONSE", message: "No response from PayPal." });
}

function toError(status: number, data: any, debugId: string | null): PayPalError {
  const issue: string | null = data?.details?.[0]?.issue ?? null;
  const description: string | null = data?.details?.[0]?.description ?? null;
  const message =
    [data?.message, issue, description].filter(Boolean).join(" | ") ||
    data?.error_description ||
    `PayPal returned ${status}`;
  return new PayPalError({
    status,
    code: data?.name ?? data?.error ?? "PAYPAL_ERROR",
    message,
    debugId: debugId ?? data?.debug_id ?? null,
    issue,
    details: data?.details,
  });
}
