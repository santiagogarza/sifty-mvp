import type {
  NotificationPreferencesInput,
  NotificationPreferencesRecord,
} from "@/lib/db/repos/types";
import { z } from "zod";

/**
 * Notification preferences: defaults, validation, quiet hours.
 *
 * A user without a saved row sees these defaults in Settings, but the digest
 * cron only walks saved rows (`NotificationPreferencesRepo.list`), because
 * the one default we cannot guess is the timezone and a 7 am plan delivered
 * at 2 am is worse than none. Saving once — which the Settings page does
 * with the browser's zone pre-filled — opts the user in.
 */

export const DEFAULT_PREFERENCES: NotificationPreferencesInput = {
  timezone: "UTC",
  emailEnabled: true,
  pushEnabled: false,
  morningPlanEnabled: true,
  morningPlanHour: 7,
  dueRemindersEnabled: true,
  dueReminderHour: 15,
  weeklyReviewEnabled: true,
  weeklyReviewDay: 0,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export interface ResolvedPreferences extends NotificationPreferencesInput {
  /** False when the user has never saved; the cron skips such users. */
  saved: boolean;
  updatedAt: string | null;
}

export function resolvePreferences(
  row: NotificationPreferencesRecord | null,
  opts: { fallbackTimeZone?: string } = {},
): ResolvedPreferences {
  if (!row) {
    const tz = opts.fallbackTimeZone;
    return {
      ...DEFAULT_PREFERENCES,
      timezone: tz && isValidTimeZone(tz) ? tz : DEFAULT_PREFERENCES.timezone,
      saved: false,
      updatedAt: null,
    };
  }
  const { userId: _u, updatedAt, ...rest } = row;
  return { ...rest, saved: true, updatedAt };
}

const timeZoneCache = new Map<string, boolean>();

/** IANA zone the runtime knows (`Europe/Ljubljana`, `America/New_York`, `UTC`). */
export function isValidTimeZone(tz: string): boolean {
  const cached = timeZoneCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = tz.length > 0 && tz.length <= 64;
  } catch {
    ok = false;
  }
  timeZoneCache.set(tz, ok);
  return ok;
}

const hour = z.number().int().min(0).max(23);

export const PreferencesSchema = z
  .object({
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, { message: "Unknown time zone" }),
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    morningPlanEnabled: z.boolean(),
    morningPlanHour: hour,
    dueRemindersEnabled: z.boolean(),
    dueReminderHour: hour,
    weeklyReviewEnabled: z.boolean(),
    weeklyReviewDay: z.number().int().min(0).max(6),
    quietHoursStart: hour.nullable(),
    quietHoursEnd: hour.nullable(),
  })
  .refine((p) => (p.quietHoursStart === null) === (p.quietHoursEnd === null), {
    message: "Quiet hours need both a start and an end",
    path: ["quietHoursEnd"],
  })
  .refine((p) => p.quietHoursStart === null || p.quietHoursStart !== p.quietHoursEnd, {
    message: "Quiet hours cannot start and end at the same hour",
    path: ["quietHoursEnd"],
  });

export type PreferencesPatch = z.infer<typeof PreferencesSchema>;

/**
 * Quiet hours are the half-open local interval [start, end) and may wrap
 * midnight: 22 → 7 covers 22, 23, 0, 1, …, 6.
 */
export function inQuietHours(
  prefs: Pick<NotificationPreferencesInput, "quietHoursStart" | "quietHoursEnd">,
  localHour: number,
): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = prefs;
  if (start === null || end === null || start === end) return false;
  if (start < end) return localHour >= start && localHour < end;
  return localHour >= start || localHour < end;
}

/**
 * Quiet hours defer rather than drop: a digest scheduled inside the window
 * goes out at the hour the window ends.
 */
export function effectiveSendHour(
  prefs: Pick<NotificationPreferencesInput, "quietHoursStart" | "quietHoursEnd">,
  scheduledHour: number,
): number {
  if (!inQuietHours(prefs, scheduledHour)) return scheduledHour;
  return prefs.quietHoursEnd as number;
}
