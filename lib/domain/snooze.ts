/**
 * Snooze = "bring this back on day X". Sifty tracks due dates at day
 * precision, so a snooze is a due date, resolved in the user's local
 * calendar (never UTC, which would roll a late-evening snooze onto the
 * wrong day).
 */

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
