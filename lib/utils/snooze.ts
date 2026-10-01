/**
 * Snooze date resolution. Pure so it can be unit-tested against any "now"
 * and any timezone.
 *
 * Targets are built from local calendar components (`new Date(y, m, d, h)`)
 * rather than by adding milliseconds, so a snooze across a DST transition
 * still lands on the requested wall-clock hour.
 */

export const SNOOZE_PRESETS = ["tomorrow", "next_week"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const DEFAULT_SNOOZE_MORNING_HOUR = 9;
/**
 * Allowed morning hours. Starting at 5 keeps every choice clear of the
 * 2-3 AM DST gap, where a local wall-clock time can fail to exist.
 */
export const SNOOZE_MORNING_HOURS = [5, 6, 7, 8, 9, 10, 11, 12] as const;

export function normalizeMorningHour(hour: number | null | undefined): number {
  return typeof hour === "number" && (SNOOZE_MORNING_HOURS as readonly number[]).includes(hour)
    ? hour
    : DEFAULT_SNOOZE_MORNING_HOUR;
}

export function resolveSnooze(
  preset: SnoozePreset,
  now: Date = new Date(),
  morningHour: number = DEFAULT_SNOOZE_MORNING_HOUR,
): Date {
  const hour = normalizeMorningHour(morningHour);
  // Sunday -> 1, Monday -> 7 (never today), Saturday -> 2.
  const days = preset === "tomorrow" ? 1 : (8 - now.getDay()) % 7 || 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0);
}

export function snoozePresetLabel(preset: SnoozePreset): string {
  return preset === "tomorrow" ? "Tomorrow" : "Next week";
}

/** "Wed 9:00 AM" in the user's locale. */
export function formatSnoozeTime(date: Date, locale?: string): string {
  const weekday = date.toLocaleDateString(locale, { weekday: "short" });
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  // Newer ICU puts a narrow no-break space before AM/PM; keep plain spaces.
  return `${weekday} ${time}`.replace(/\u202f/g, " ");
}

export function isSnoozed(task: { snoozedUntil: string | null }, now: Date = new Date()): boolean {
  return !!task.snoozedUntil && new Date(task.snoozedUntil).getTime() > now.getTime();
}

/**
 * Custom-date fallback: a `YYYY-MM-DD` from a date input resolves to the
 * morning hour on that local day.
 */
export function snoozeFromDateInput(value: string, morningHour: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d), normalizeMorningHour(morningHour), 0, 0, 0);
}
