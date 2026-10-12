/**
 * Date utilities for a calm UI.
 *
 * Two rules:
 * 1. Prefer relative phrasing for nearby dates ("today", "tomorrow",
 *    "in 3 days") because it's faster to scan in a list.
 * 2. Switch to absolute "Mon Jan 6" for anything beyond a week — relative
 *    becomes ambiguous quickly.
 */

const dayMs = 24 * 60 * 60 * 1000;

const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a stored date. Due dates are day-precision `YYYY-MM-DD` strings
 * meaning "that calendar day", so they must resolve in the user's local
 * zone — `new Date("2026-10-13")` would read UTC midnight, which is still
 * the 12th anywhere west of Greenwich. Full ISO timestamps parse as usual.
 */
export function parseDay(value: string | Date): Date {
  if (value instanceof Date) return value;
  const m = DAY_ONLY.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(value);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function dayDelta(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / dayMs);
}

export function formatRelativeDay(
  value: string | Date | null | undefined,
  now = new Date(),
): string | null {
  if (!value) return null;
  const date = parseDay(value);
  if (Number.isNaN(date.getTime())) return null;
  const delta = dayDelta(date, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta <= 6) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (delta < -1 && delta >= -6) {
    return `${-delta} days ago`;
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

export function isOverdue(due: string | Date | null | undefined, now = new Date()): boolean {
  if (!due) return false;
  const date = parseDay(due);
  if (Number.isNaN(date.getTime())) return false;
  return dayDelta(date, now) < 0;
}

export function isToday(due: string | Date | null | undefined, now = new Date()): boolean {
  if (!due) return false;
  const date = parseDay(due);
  if (Number.isNaN(date.getTime())) return false;
  return dayDelta(date, now) === 0;
}

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day (`YYYY-MM-DD`) it is at `now` in an IANA zone. Server
 * code uses this instead of `toLocalIsoDate` (which reads the process
 * zone — UTC on Vercel) so "today" for a user in Ljubljana is Ljubljana's
 * day. An unknown zone falls back to UTC rather than throwing.
 */
export function dayKeyInTimeZone(now: Date, timeZone: string): string {
  let f = dayKeyFormatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    dayKeyFormatters.set(timeZone, f);
  }
  // en-CA prints `YYYY-MM-DD`.
  return f.format(now);
}

/** The local hour (0–23) at `now` in an IANA zone; UTC when the zone is unknown. */
export function hourInTimeZone(now: Date, timeZone: string): number {
  let hour: string;
  try {
    hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .find((p) => p.type === "hour")!.value;
  } catch {
    return now.getUTCHours();
  }
  // Some ICU builds print midnight as "24" even with h23.
  return Number(hour) % 24;
}

/** Calendar arithmetic on a `YYYY-MM-DD` key, independent of any zone. */
export function addDaysToKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `fromKey` to `toKey` (positive when `toKey` is later). */
export function dayKeyDelta(toKey: string, fromKey: string): number {
  const [ty, tm, td] = toKey.split("-").map(Number) as [number, number, number];
  const [fy, fm, fd] = fromKey.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / dayMs);

/** "just now", "12m ago", "3h ago", then day granularity via `formatRelativeDay`. */
export function formatTimeAgo(value: string | Date, now = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24 && dayDelta(date, now) === 0) return `${hours}h ago`;
  return formatRelativeDay(date, now) ?? "";
}

export function formatExactTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
