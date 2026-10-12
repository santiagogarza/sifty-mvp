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
