"use client";

import { useEffect, useState } from "react";
import { Button, Card, Chip, cx, money } from "@/components/ui/atoms";
import { api, ApiError, toast } from "@/lib/client/store";
import type { Person, Settings } from "@/lib/desk/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Health = {
  paypal: { configured: boolean; environment: string; webhookId: boolean };
  ai: { configured: boolean; model: string; visionModel: string; fallbackModel: string };
  store: string;
  adminReset: boolean;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings").then((r) => setSettings(r.settings)).catch(() => toast("error", "Could not load settings"));
    api<Health>("/api/health").then(setHealth).catch(() => undefined);
  }, []);

  if (!settings) return <p className="py-10 text-center text-muted" role="status">Loading settings…</p>;

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const setPerson = (id: string, patch: Partial<Person>) => set({ team: settings.team.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: settings });
      setSettings(res.settings);
      toast("success", "Settings saved", "Marlow uses the new rules from the next case it touches.");
    } catch (err) {
      toast("error", "Could not save settings", err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    setResetResult(null);
    try {
      const res = await api<{ disputes: number; untouched: number; resolved: number }>("/api/admin/reset", { method: "POST", headers: { "x-admin-token": token } });
      setResetResult(`Reset done. ${res.disputes} disputes re-read from PayPal: ${res.untouched} still need a response, ${res.resolved} resolved.`);
      toast("success", "Demo state restored");
      const fresh = await api<{ settings: Settings }>("/api/settings");
      setSettings(fresh.settings);
    } catch (err) {
      toast("error", "Reset failed", err instanceof ApiError ? err.message : undefined);
    } finally {
      setResetting(false);
    }
  };

  const example = settings.autoAcceptEnabled
    ? `A ${money(Math.max(1, settings.autoAcceptUnder - 3))} claim with weak evidence: Marlow accepts it and tells you. A ${money(settings.alwaysAskAbove + 40)} claim: Marlow builds the case and waits for you, whatever the evidence.`
    : `Auto-accept is off: Marlow never files anything by itself. A ${money(settings.alwaysAskAbove + 40)} claim is flagged as above your always-ask amount.`;

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-4">
      <h1 className="text-xl font-extrabold tracking-tight">Settings</h1>

      <Card className="px-5 py-4" aria-labelledby="rules-title">
        <h2 id="rules-title" className="text-[17px] font-bold">Your rules for Marlow</h2>
        <p className="text-[13.5px] text-muted">These are checked in code before anything is sent to PayPal. The model cannot override them.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <fieldset className="rounded-xl border border-line px-4 py-3">
            <legend className="px-1 text-[14px] font-bold">Auto-accept small, weak cases</legend>
            <label className="flex items-center gap-2 text-[14.5px]">
              <input type="checkbox" className="h-5 w-5 accent-[#2f5d4a]" checked={settings.autoAcceptEnabled} onChange={(e) => set({ autoAcceptEnabled: e.target.checked })} data-testid="auto-accept-toggle" />
              Let Marlow accept without asking
            </label>
            <label className="mt-2 block text-[14px] font-semibold" htmlFor="auto-under">when the amount is under</label>
            <div className="mt-1 flex items-center gap-1">
              <span aria-hidden="true">$</span>
              <input id="auto-under" type="number" min={0} max={500} step={1} value={settings.autoAcceptUnder} onChange={(e) => set({ autoAcceptUnder: Number(e.target.value) })} className="w-28 rounded-lg border border-line bg-paper px-2 py-2" disabled={!settings.autoAcceptEnabled} data-testid="auto-accept-under" />
              <span className="text-[13.5px] text-muted">and the evidence is weak</span>
            </div>
          </fieldset>
          <fieldset className="rounded-xl border border-line px-4 py-3">
            <legend className="px-1 text-[14px] font-bold">Always ask me</legend>
            <label className="block text-[14px] font-semibold" htmlFor="ask-above">above this amount, a person decides everything</label>
            <div className="mt-1 flex items-center gap-1">
              <span aria-hidden="true">$</span>
              <input id="ask-above" type="number" min={0} step={5} value={settings.alwaysAskAbove} onChange={(e) => set({ alwaysAskAbove: Number(e.target.value) })} className="w-28 rounded-lg border border-line bg-paper px-2 py-2" data-testid="always-ask-above" />
            </div>
            <p className="mt-2 text-[13px] text-muted">Evidence, offers and messages always wait for approval at any amount.</p>
          </fieldset>
          <fieldset className="rounded-xl border border-line px-4 py-3">
            <legend className="px-1 text-[14px] font-bold">The economics</legend>
            <label className="block text-[14px] font-semibold" htmlFor="hourly">An hour of staff time costs</label>
            <div className="mt-1 flex items-center gap-1"><span aria-hidden="true">$</span><input id="hourly" type="number" min={0} step={1} value={settings.hourlyCost} onChange={(e) => set({ hourlyCost: Number(e.target.value) })} className="w-28 rounded-lg border border-line bg-paper px-2 py-2" /></div>
            <label className="mt-2 block text-[14px] font-semibold" htmlFor="fee">PayPal dispute fee on a lost claim</label>
            <div className="mt-1 flex items-center gap-1"><span aria-hidden="true">$</span><input id="fee" type="number" min={0} step={1} value={settings.disputeFee} onChange={(e) => set({ disputeFee: Number(e.target.value) })} className="w-28 rounded-lg border border-line bg-paper px-2 py-2" /></div>
            <p className="mt-2 text-[13px] text-muted">Set this to the dispute fee on your own PayPal fee schedule.</p>
          </fieldset>
          <fieldset className="rounded-xl border border-line px-4 py-3">
            <legend className="px-1 text-[14px] font-bold">Scheduling</legend>
            <label className="flex items-center gap-2 text-[14.5px]">
              <input type="checkbox" className="h-5 w-5 accent-[#2f5d4a]" checked={settings.autoSchedule} onChange={(e) => set({ autoSchedule: e.target.checked })} data-testid="auto-schedule-toggle" />
              Marlow books new disputes into free time
            </label>
            <p className="mt-2 text-[13px] text-muted">Off: new disputes wait in the Unscheduled panel until someone drags them onto the board. Store time is {settings.timezone.replace(/_/g, " ")}.</p>
          </fieldset>
        </div>
        <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-[13.5px]" data-testid="rules-example"><span className="font-semibold">What that means: </span>{example}</p>
      </Card>

      <Card className="px-5 py-4" aria-labelledby="team-title">
        <h2 id="team-title" className="text-[17px] font-bold">Team and working hours</h2>
        <p className="text-[13.5px] text-muted">Marlow only books dispute work inside these hours, and no more than two and a half hours of it per person per day.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-[12.5px] uppercase tracking-wide text-muted">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Person</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Days</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">From</th>
                <th scope="col" className="py-1.5 font-semibold">To</th>
              </tr>
            </thead>
            <tbody>
              {settings.team.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold">
                    {p.name} <span className="block text-[12.5px] font-normal text-muted">{p.role}</span>
                  </th>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Working days for ${p.name}`}>
                      {DAYS.map((d, i) => {
                        const on = p.days.includes(i + 1);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            disabled={p.isAgent}
                            onClick={() => setPerson(p.id, { days: on ? p.days.filter((x) => x !== i + 1) : [...p.days, i + 1].sort() })}
                            className={cx("min-h-9 min-w-11 rounded-md border px-1.5 text-[12.5px] font-semibold", on ? "border-forest bg-forest text-white" : "border-line bg-surface text-muted", p.isAgent && "opacity-70")}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <label className="sr-only" htmlFor={`start-${p.id}`}>Start hour for {p.name}</label>
                    <input id={`start-${p.id}`} type="number" min={0} max={23} value={p.start} disabled={p.isAgent} onChange={(e) => setPerson(p.id, { start: Number(e.target.value) })} className="w-16 rounded-lg border border-line bg-paper px-2 py-1.5" />
                  </td>
                  <td className="py-2">
                    <label className="sr-only" htmlFor={`end-${p.id}`}>End hour for {p.name}</label>
                    <input id={`end-${p.id}`} type="number" min={1} max={24} value={p.end} disabled={p.isAgent} onChange={(e) => setPerson(p.id, { end: Number(e.target.value) })} className="w-16 rounded-lg border border-line bg-paper px-2 py-1.5" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Button onClick={save} disabled={saving} data-testid="save-settings">{saving ? "Saving…" : "Save settings"}</Button>
        </div>
      </Card>

      <Card className="px-5 py-4" aria-labelledby="sys-title">
        <h2 id="sys-title" className="text-[17px] font-bold">This deployment</h2>
        {health ? (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
            <dt className="text-muted">PayPal</dt>
            <dd>{health.paypal.configured ? <Chip tone="ready">sandbox credentials set</Chip> : <Chip tone="missing">credentials missing</Chip>} {health.paypal.webhookId ? <Chip tone="ready">webhook id set</Chip> : <Chip tone="partial">no webhook id: polling only</Chip>}</dd>
            <dt className="text-muted">Models</dt>
            <dd>{health.ai.configured ? `${health.ai.model} for text and tools, ${health.ai.visionModel} for photos, ${health.ai.fallbackModel} as fallback` : "No model key set: rule-based results only"}</dd>
            <dt className="text-muted">State</dt>
            <dd>{health.store === "blob" ? "Vercel Blob" : "Local files under .data/"}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-muted">Checking…</p>
        )}
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-[14.5px] font-bold">Restore the seeded demo state</h3>
          <p className="text-[13.5px] text-muted">Clears the desk&apos;s own state (bookings, drafts, trails, settings) and rebuilds it from PayPal. It cannot un-resolve a dispute: resolved cases stay resolved in PayPal.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor="admin-token" className="sr-only">Admin token</label>
            <input id="admin-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" autoComplete="off" className="min-h-11 w-64 rounded-lg border border-line bg-paper px-3" data-testid="admin-token" />
            <Button variant="secondary" onClick={reset} disabled={resetting || !token || !health?.adminReset} data-testid="admin-reset">{resetting ? "Resetting…" : "Reset demo"}</Button>
          </div>
          {resetResult && <p className="mt-2 text-[13.5px] text-ready" role="status">{resetResult}</p>}
        </div>
      </Card>
    </div>
  );
}
