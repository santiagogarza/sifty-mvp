import type { ISODate, Task } from "./types";

/**
 * Snooze: "not now, ask me again on <day>".
 *
 * `snoozedUntil` is a local `YYYY-MM-DD` wake day, the same day precision
 * as `due`. A task is snoozed while its wake day is still in the future;
 * on the wake day the comparison flips and the task is back in its view.
 * There is no wake-up job — every device derives the same answer from the
 * date alone.
 *
 * All math here is in local time. `toISOString()` would convert to UTC and
 * slip a day for anyone west of Greenwich in the evening.
 */

export type SnoozePreset = "tomorrow" | "weekend" | "next_week";

export const SNOOZE_PRESETS: ReadonlyArray<{ id: SnoozePreset; label: string; key: string }> = [
  { id: "tomorrow", label: "Tomorrow", key: "T" },
  { id: "weekend", label: "This weekend", key: "W" },
  { id: "next_week", label: "Next week", key: "N" },
];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localIsoDate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight of an ISO day; `new Date("YYYY-MM-DD")` would be UTC. */
export function parseLocalIsoDate(iso: ISODate): Date | null {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addLocalDays(now: Date, days: number): ISODate {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return localIsoDate(d);
}

export function snoozeDateFor(preset: SnoozePreset, now = new Date()): ISODate {
  const weekday = now.getDay(); // 0 = Sunday … 6 = Saturday
  switch (preset) {
    case "tomorrow":
      return addLocalDays(now, 1);
    case "weekend":
      // Already in a weekend: "this weekend" has started, so the next one.
      return addLocalDays(now, weekday === 6 ? 7 : 6 - weekday);
    case "next_week":
      return addLocalDays(now, (1 - weekday + 7) % 7 || 7);
  }
}

export function isSnoozed(task: Pick<Task, "snoozedUntil">, now = new Date()): boolean {
  return !!task.snoozedUntil && task.snoozedUntil > localIsoDate(now);
}

/** A custom wake day must be strictly after today. */
export function isValidSnoozeDate(iso: string, now = new Date()): boolean {
  return parseLocalIsoDate(iso) !== null && iso > localIsoDate(now);
}

/** "Sat, Nov 14" */
export function formatSnoozeDate(iso: ISODate): string {
  const d = parseLocalIsoDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Compact wake day for row badges: "Tomorrow", "Sat", or "Nov 20". */
export function formatSnoozeShort(iso: ISODate, now = new Date()): string {
  const d = parseLocalIsoDate(iso);
  if (!d) return iso;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 1) return "Tomorrow";
  if (days > 1 && days <= 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
