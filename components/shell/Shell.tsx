"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { MarlowMark } from "@/components/marlow/Marlow";
import { cx } from "@/components/ui/atoms";
import { clearCalls, dismissToast, setDrawer, setMode, setVoice, useDeskStore } from "@/lib/client/store";

const NAV = [
  { href: "/", label: "Board" },
  { href: "/cases", label: "Cases" },
  { href: "/prevention", label: "Prevention" },
  { href: "/settings", label: "Settings" },
  { href: "/store", label: "Demo store" },
];

function ModeToggle() {
  const mode = useDeskStore((s) => s.mode);
  return (
    <div role="group" aria-label="Data source" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[13px] font-semibold" data-testid="mode-toggle">
      {(["live", "replay"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          data-testid={`mode-${m}`}
          onClick={() => {
            if (mode === m) return;
            setMode(m);
            window.location.reload();
          }}
          className={cx("min-h-9 rounded-md px-3", mode === m ? (m === "live" ? "bg-forest text-white" : "bg-partial-edge text-[#2a1a00]") : "text-muted hover:bg-sunken")}
          title={m === "live" ? "Live: every screen reads the PayPal sandbox" : "Replay: recorded sandbox and AI responses, for when either is down"}
        >
          {m === "live" ? "Live sandbox" : "Replay"}
        </button>
      ))}
    </div>
  );
}

function VoiceToggle() {
  const voice = useDeskStore((s) => s.voice);
  return (
    <button
      type="button"
      aria-pressed={voice}
      onClick={() => setVoice(!voice)}
      className={cx("hidden min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold md:inline-flex", voice ? "border-capy bg-[#f1e3d3] text-capy-dark" : "border-line bg-surface text-muted hover:bg-sunken")}
      title="Marlow says a short line when something important happens. The same words are always on screen."
      data-testid="voice-toggle"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4z" />
        {voice ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6m0-6-5 6" />}
      </svg>
      Voice {voice ? "on" : "off"}
    </button>
  );
}

function UnderTheHood() {
  const calls = useDeskStore((s) => s.calls);
  const open = useDeskStore((s) => s.drawerOpen);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const rows = [...calls].reverse();
  return (
    <div className="fixed inset-0 z-[9000]" data-testid="hood-drawer">
      <button type="button" aria-label="Close Under the hood" className="absolute inset-0 bg-[rgb(31_42_36/0.45)]" onClick={() => setDrawer(false)} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="hood-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="hood-title" className="text-lg font-bold">Under the hood</h2>
            <p className="text-sm text-muted">Every PayPal API call this browser session has caused, newest first. {calls.length} so far.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="min-h-9 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-sunken" onClick={clearCalls}>Clear</button>
            <button ref={closeRef} type="button" className="min-h-9 rounded-lg bg-forest px-3 text-sm font-semibold text-white hover:bg-forest-deep" onClick={() => setDrawer(false)} data-testid="hood-close">Close</button>
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="p-6 text-muted">No PayPal calls yet. Open the board or a case and they will appear here.</p>
          ) : (
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">PayPal API calls made in this session</caption>
              <thead className="sticky top-0 bg-paper text-left text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Call</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-2 py-2 font-semibold">PayPal-Debug-Id</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Triggered by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-t border-line align-top" data-testid="hood-row">
                    <td className="px-4 py-2">
                      <span className={cx("mr-2 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold", c.method === "GET" ? "bg-slate-tint text-slate" : "bg-forest-tint text-forest-deep")}>{c.method}</span>
                      <code className="break-all font-mono text-[12.5px]">{c.path}</code>
                      <div className="mt-0.5 text-[11.5px] text-muted">
                        {c.via === "sdk" ? "paypal-server-sdk" : c.via === "toolkit" ? "agent-toolkit" : "REST"}
                        {" · "}
                        {c.ms} ms
                        {c.replay ? " · replayed from a recording" : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className={cx("font-bold", c.status >= 200 && c.status < 300 ? "text-ready" : c.status === 0 ? "text-partial" : "text-missing")}>{c.status === 0 ? "none" : c.status}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[12px]">{c.debugId ?? "n/a"}</td>
                    <td className="px-4 py-2">{c.feature}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </div>
  );
}

function Toasts() {
  const toasts = useDeskStore((s) => s.toasts);
  const announcement = useDeskStore((s) => s.announcement);
  return (
    <>
      <div aria-live="polite" role="status" className="sr-only-live" data-testid="live-region">{announcement}</div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9500] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto rounded-xl border px-4 py-3 shadow-lg",
              t.kind === "error" ? "border-missing-edge bg-missing-tint text-missing" : t.kind === "success" ? "border-ready-edge bg-ready-tint text-ready" : "border-line bg-surface text-ink",
            )}
            data-testid={`toast-${t.kind}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm">{t.body}</p>}
              </div>
              <button type="button" aria-label="Dismiss" className="-mr-1 -mt-1 min-h-8 min-w-8 rounded-md text-lg leading-none hover:bg-[rgb(0_0_0/0.06)]" onClick={() => dismissToast(t.id)}>×</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const calls = useDeskStore((s) => s.calls.length);
  const mode = useDeskStore((s) => s.mode);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[9999] focus:rounded-lg focus:bg-forest focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line bg-[rgb(247_245_239/0.94)] backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="Dispute Desk home">
            <MarlowMark size={34} />
            <span className="leading-tight">
              <span className="block text-[17px] font-extrabold tracking-tight">Dispute Desk</span>
              <span className="hidden text-[11.5px] text-muted sm:block">for Juniper &amp; Moss</span>
            </span>
          </Link>
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={cx("min-h-10 whitespace-nowrap rounded-lg px-3 py-2 text-[14.5px] font-semibold", isActive(n.href) ? "bg-forest-tint text-forest-deep" : "text-muted hover:bg-sunken hover:text-ink")}
                data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <VoiceToggle />
            <ModeToggle />
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13.5px] font-semibold hover:bg-sunken"
              data-testid="hood-open"
              aria-haspopup="dialog"
            >
              Under the hood
              <span className="rounded-full bg-forest px-2 py-0.5 text-[12px] text-white" aria-label={`${calls} PayPal calls`}>{calls}</span>
            </button>
          </div>
        </div>
        {mode === "replay" && (
          <div className="border-t border-partial-edge bg-partial-tint px-4 py-1.5 text-center text-[13.5px] font-semibold text-partial" role="note" data-testid="replay-banner">
            Replay mode: recorded PayPal sandbox and AI responses, not live calls. Waits that took minutes in the sandbox are played in seconds.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:no-underline"
              onClick={async () => {
                await fetch("/api/replay/reset", { method: "POST" }).catch(() => undefined);
                if (pathname === "/") window.location.reload();
                else router.push("/");
              }}
              data-testid="replay-restart"
            >
              Start the recording over
            </button>
          </div>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5">{children}</main>
      <footer className="border-t border-line px-4 py-4 text-center text-[12.5px] text-muted">
        Dispute Desk is a hackathon prototype. PayPal sandbox only: no real money moves. Juniper &amp; Moss, its customers and its carriers are fictional.
      </footer>
      <UnderTheHood />
      <Toasts />
    </div>
  );
}
