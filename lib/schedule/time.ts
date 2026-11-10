/** Small timezone helpers so working hours are computed in the store's timezone, not the server's. */

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday] ?? 1,
  };
}

/** The UTC instant for a wall-clock time in a timezone. decimalHour 9.5 means 09:30. */
export function zonedToUtc(year: number, month: number, day: number, decimalHour: number, tz: string): Date {
  const hour = Math.floor(decimalHour);
  const minute = Math.round((decimalHour - hour) * 60);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(year, month - 1, day, hour, minute) - asUtc;
  }
  return new Date(guess);
}

/** Calendar day in the timezone, n days after the day containing `date`. */
export function addZonedDays(date: Date, days: number, tz: string): { year: number; month: number; day: number; weekday: number } {
  const p = zonedParts(date, tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12));
  const weekday = ((shifted.getUTCDay() + 6) % 7) + 1;
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday };
}

export function formatInZone(date: Date | string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(date));
}

export function slotLabel(date: Date | string, tz: string): string {
  return formatInZone(date, tz, { weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(",", "");
}

export function dayLabel(date: Date | string, tz: string): string {
  return formatInZone(date, tz, { weekday: "long" });
}
