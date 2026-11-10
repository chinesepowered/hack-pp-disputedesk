/**
 * One wrapper for every API route: session and mode cookies, the PayPal call recorder, a
 * per-IP rate limit for AI routes, and one mapping from failures to HTTP answers.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AiUnavailableError } from "@/lib/ai/client";
import { DeskError } from "@/lib/desk/filing";
import { PayPalError } from "@/lib/paypal/http";
import { runWithRecorder, type Mode, type PayPalCall } from "@/lib/paypal/log";

export type RouteContext = { mode: Mode; sessionId: string; params: Record<string, string>; ip: string };

type Handler = (req: NextRequest, ctx: RouteContext) => Promise<Record<string, unknown> | Response>;

/** The one place where a failure becomes what the caller sees (see paypal-plan.md). */
export function toHttp(err: unknown): { status: number; body: { code: string; message: string; debugId?: string | null; extra?: unknown } } {
  if (err instanceof DeskError) return { status: err.status, body: { code: err.code, message: err.message, extra: err.extra } };
  if (err instanceof PayPalError) {
    if (err.unknownOutcome || err.status === 0) return { status: 502, body: { code: "PAYPAL_NO_RESPONSE", message: "PayPal did not answer. Try again." } };
    if (err.status === 401 || err.status === 403) return { status: 502, body: { code: "PAYPAL_AUTH", message: "PayPal refused our credentials.", debugId: err.debugId } };
    if (err.status === 429) return { status: 503, body: { code: "PAYPAL_RATE_LIMIT", message: "PayPal is rate limiting this app. Try again shortly.", debugId: err.debugId } };
    if (err.status >= 400 && err.status < 500) {
      // The caller's request was refused: hand back PayPal's own reason.
      return { status: err.status, body: { code: err.issue ?? err.code, message: `PayPal said no: ${err.issue ?? err.code}.`, debugId: err.debugId } };
    }
    return { status: 502, body: { code: "PAYPAL_ERROR", message: "PayPal had a problem. Try again.", debugId: err.debugId } };
  }
  if (err instanceof AiUnavailableError) return { status: 503, body: { code: "AI_UNAVAILABLE", message: "The model did not answer. The rule-based result is still available." } };
  console.error("[route] unexpected error", err);
  return { status: 500, body: { code: "UNEXPECTED", message: "Something went wrong on our side." } };
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Best-effort limit per IP for routes that call the model. */
function allowAi(ip: string, limit = 40, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function route(feature: string, handler: Handler, opts: { ai?: boolean } = {}) {
  return async (req: NextRequest, extra: { params: Promise<Record<string, string>> }) => {
    const params = (await extra.params) ?? {};
    const mode: Mode = req.cookies.get("dd_mode")?.value === "replay" ? "replay" : "live";
    const existing = req.cookies.get("dd_sid")?.value;
    const sessionId = existing && /^[a-zA-Z0-9-]{8,64}$/.test(existing) ? existing : randomUUID();
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();

    let calls: PayPalCall[] = [];
    let response: NextResponse;
    if (opts.ai && mode === "live" && !allowAi(ip)) {
      response = NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many AI requests from this address. Try again in a few minutes." }, paypalCalls: [], mode }, { status: 429 });
    } else {
      // Errors are caught inside the recorder so the PayPal calls made before a failure are
      // still returned to the Under the hood drawer.
      const out = await runWithRecorder({ feature, mode, sessionId }, async () => {
        try {
          return { ok: true as const, value: await handler(req, { mode, sessionId, params, ip }) };
        } catch (err) {
          return { ok: false as const, err };
        }
      });
      calls = out.calls;
      if (out.result.ok) {
        if (out.result.value instanceof Response) return out.result.value;
        response = NextResponse.json({ ...out.result.value, paypalCalls: calls, mode });
      } else {
        const http = toHttp(out.result.err);
        response = NextResponse.json({ error: http.body, paypalCalls: calls, mode }, { status: http.status });
      }
    }
    if (!existing) response.cookies.set("dd_sid", sessionId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}
