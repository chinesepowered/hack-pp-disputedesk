"use client";

/**
 * Browser-side state shared across pages: the PayPal call log for this session (shown in the
 * Under the hood drawer), the Live or Replay mode, toasts and screen reader announcements.
 */
import { useSyncExternalStore } from "react";
import type { PayPalCall } from "@/lib/paypal/log";
import type { MarlowLine } from "./voice-lines";

export type Toast = { id: number; kind: "info" | "success" | "error"; title: string; body?: string };
export type Mode = "live" | "replay";

type State = { calls: PayPalCall[]; toasts: Toast[]; announcement: string; mode: Mode; drawerOpen: boolean; voice: boolean };

const CALLS_KEY = "dd_calls";
let state: State = { calls: [], toasts: [], announcement: "", mode: "live", drawerOpen: false, voice: false };
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  let calls: PayPalCall[] = [];
  try {
    calls = JSON.parse(sessionStorage.getItem(CALLS_KEY) ?? "[]");
  } catch {
    calls = [];
  }
  const mode: Mode = /(?:^|; )dd_mode=replay/.test(document.cookie) ? "replay" : "live";
  let voice = false;
  try {
    voice = localStorage.getItem("dd_voice") === "1";
  } catch {
    voice = false;
  }
  state = { ...state, calls, mode, voice };
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  // Hydration happens after the first server-matching render, so tell subscribers once.
  queueMicrotask(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: State = { calls: [], toasts: [], announcement: "", mode: "live", drawerOpen: false, voice: false };

export function useDeskStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(SERVER_STATE),
  );
}

export function recordCalls(calls: PayPalCall[] | undefined) {
  if (!calls?.length) return;
  const next = [...state.calls, ...calls].slice(-300);
  set({ calls: next });
  try {
    sessionStorage.setItem(CALLS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the in-memory list still works for this page.
  }
}

export function clearCalls() {
  set({ calls: [] });
  try {
    sessionStorage.removeItem(CALLS_KEY);
  } catch {
    // ignore
  }
}

let toastId = 0;
export function toast(kind: Toast["kind"], title: string, body?: string) {
  const id = ++toastId;
  set({ toasts: [...state.toasts, { id, kind, title, body }], announcement: body ? `${title}. ${body}` : title });
  setTimeout(() => dismissToast(id), kind === "error" ? 9000 : 6000);
}

export function dismissToast(id: number) {
  set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

/** Polite announcement for async updates that have no toast. */
export function announce(message: string) {
  set({ announcement: message });
}

export function setMode(mode: Mode) {
  document.cookie = `dd_mode=${mode}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  set({ mode });
}

/** Marlow's voice is off until someone turns it on. The lines are pre-rendered audio files. */
export function setVoice(on: boolean) {
  try {
    localStorage.setItem("dd_voice", on ? "1" : "0");
  } catch {
    // ignore
  }
  set({ voice: on });
  if (on) say("ready");
}

let playing: HTMLAudioElement | null = null;

export function say(line: MarlowLine) {
  hydrate();
  if (!state.voice || typeof Audio === "undefined") return;
  try {
    playing?.pause();
    playing = new Audio(`/audio/marlow-${line}.mp3`);
    void playing.play().catch(() => undefined);
  } catch {
    // Audio is a nicety: the same words are always on screen.
  }
}

export function setDrawer(open: boolean) {
  set({ drawerOpen: open });
}

export class ApiError extends Error {
  code: string;
  status: number;
  debugId?: string | null;
  extra?: unknown;
  constructor(status: number, code: string, message: string, debugId?: string | null, extra?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.debugId = debugId;
    this.extra = extra;
  }
}

/** fetch for this app's API: records the PayPal calls each response reports. */
export async function api<T = any>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T> {
  hydrate();
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: { ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the server. Check your connection and try again.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  recordCalls(data?.paypalCalls);
  if (!res.ok || data?.error) {
    throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.debugId, data?.error?.extra);
  }
  return data as T;
}
