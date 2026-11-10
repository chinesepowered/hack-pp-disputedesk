/**
 * Which disputes the desk tracks. A shop that starts using the desk mid-month, or a sandbox
 * account with old experiments in it, sets a start time and older disputes are left alone.
 */
import config from "@/data/desk-config.json";

export function trackFrom(): number | null {
  const fromEnv = process.env.DESK_TRACK_FROM?.trim();
  if (fromEnv === "null" || fromEnv === "none") return null;
  const value = fromEnv || (config as { trackFrom?: string | null }).trackFrom;
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function isTracked(createTime: string | undefined): boolean {
  const from = trackFrom();
  if (from === null || !createTime) return true;
  return Date.parse(createTime) >= from;
}
