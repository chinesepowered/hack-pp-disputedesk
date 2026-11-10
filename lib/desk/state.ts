/** Reading and writing the desk's own working state through lib/store.ts. */
import { deleteDoc, getDoc, listKeys, setDoc } from "@/lib/store";
import { currentMode, currentSessionId } from "@/lib/paypal/log";
import { DEFAULT_SETTINGS, EMPTY_DESK, type CaseDetail, type Desk, type Settings, type TrailStep } from "./types";

/**
 * Live state is shared (PayPal's disputes are shared too). Replay state is kept per browser
 * session so one visitor's replay never touches another's, or the live desk.
 */
function ns(): string {
  return currentMode() === "replay" ? `replay-${currentSessionId()}-` : "";
}

export async function loadDesk(): Promise<Desk> {
  const desk = await getDoc<Desk>(`${ns()}desk`);
  return desk ?? structuredClone(EMPTY_DESK);
}

export async function saveDesk(desk: Desk): Promise<void> {
  await setDoc(`${ns()}desk`, desk);
}

export async function loadSettings(): Promise<Settings> {
  const saved = await getDoc<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}), team: saved?.team?.length ? saved.team : DEFAULT_SETTINGS.team };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await setDoc("settings", settings);
}

export async function loadCase(disputeId: string): Promise<CaseDetail | null> {
  return getDoc<CaseDetail>(`${ns()}case-${disputeId}`);
}

export async function saveCase(detail: CaseDetail): Promise<void> {
  await setDoc(`${ns()}case-${detail.disputeId}`, detail);
}

export function addTrail(detail: CaseDetail, step: Omit<TrailStep, "at">): void {
  detail.trail.push({ at: new Date().toISOString(), ...step });
  if (detail.trail.length > 120) detail.trail.splice(0, detail.trail.length - 120);
}

/** Remove the desk's working state (not PayPal's). Used by the admin reset. */
export async function wipeDeskState(prefix = ""): Promise<number> {
  let removed = 0;
  for (const key of await listKeys(`${prefix}case-`)) {
    await deleteDoc(key);
    removed++;
  }
  await deleteDoc(`${prefix}desk`);
  return removed + 1;
}
