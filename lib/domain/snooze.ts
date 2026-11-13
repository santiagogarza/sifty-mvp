/**
 * Snooze = "bring this back on day X".
 *
 * The list chord (`s` then `t` / `w`) still parks a task by moving its due
 * date. `snoozeUntil` is the separate wake date: Today and Inbox hide the
 * task until 8:00 local on that day, and the lifecycle does not change.
 *
 * Day math is local. UTC would roll a late-evening choice onto the wrong day.
 */

import { dayKeyInTimeZone, hourInTimeZone, parseDateOnly, toDateOnly } from "@/lib/utils/dates";

export const SNOOZE_PRESETS = ["tomorrow", "next_week"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_LABELS: Record<SnoozePreset, string> = {
  tomorrow: "Tomorrow",
  next_week: "Next week",
};

/** Keyboard letter for each preset, used after the `s` prefix in lists. */
export const SNOOZE_KEYS: Record<SnoozePreset, string> = {
  tomorrow: "t",
  next_week: "w",
};

export function presetForKey(key: string): SnoozePreset | null {
  const match = SNOOZE_PRESETS.find((p) => SNOOZE_KEYS[p] === key);
  return match ?? null;
}

/**
 * The target day as a local `YYYY-MM-DD`.
 *
 * - `tomorrow`: the next calendar day.
 * - `next_week`: the next Monday. On a Monday that is seven days out, never
 *   today. Date arithmetic via `setDate` keeps wall-clock days intact across
 *   DST changes (adding 24h would not).
 */
export function resolveSnooze(preset: SnoozePreset, now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "tomorrow") {
    d.setDate(d.getDate() + 1);
  } else {
    const weekday = d.getDay(); // 0 = Sunday … 6 = Saturday
    const daysToMonday = weekday === 0 ? 1 : 8 - weekday;
    d.setDate(d.getDate() + daysToMonday);
  }
  return toLocalIsoDate(d);
}

/** Short human form of the resolved day, e.g. "Tue, Oct 13". */
export function describeSnooze(preset: SnoozePreset, now = new Date()): string {
  const [y, m, day] = resolveSnooze(preset, now).split("-").map(Number);
  return new Date(y!, m! - 1, day!).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function toLocalIsoDate(d: Date): string {
  return toDateOnly(d);
}

/** Local hour a `snoozeUntil` day starts counting as awake. */
export const SNOOZE_WAKE_HOUR = 8;

/**
 * True while `snoozeUntil` is still in the future, including the wake morning
 * before 8:00. After 8:00 the task is awake even if the date is still stored.
 * Pass `timeZone` on the server; the browser's zone is the default.
 */
export function isSnoozed(
  task: { snoozeUntil?: string | null },
  now = new Date(),
  timeZone?: string,
): boolean {
  const until = task.snoozeUntil;
  if (!until || !parseDateOnly(until)) return false;
  const todayKey = timeZone ? dayKeyInTimeZone(now, timeZone) : toDateOnly(now);
  if (until > todayKey) return true;
  if (until < todayKey) return false;
  const hour = timeZone ? hourInTimeZone(now, timeZone) : now.getHours();
  return hour < SNOOZE_WAKE_HOUR;
}
