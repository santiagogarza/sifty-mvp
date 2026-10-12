import type { DigestKind, NotificationPreferencesInput } from "@/lib/db/repos/types";
import { effectiveSendHour } from "./preferences";

/**
 * Timezone and scheduling math for digests. Pure functions; the cron
 * route and the tests both call these with an explicit `now`.
 *
 * Everything is computed in the user's IANA zone through `Intl`, so DST
 * transitions are handled by the runtime's zone database rather than by
 * fixed offsets: "7 am in New York" resolves to 12:00 UTC in March and
 * 11:00 UTC in November without this module knowing when the clocks move.
 */

export interface LocalTime {
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Local calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  /** ISO week of the local day, `YYYY-Www`. */
  weekKey: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    // Some ICU builds print midnight as "24" even with h23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    dayOfWeek: WEEKDAYS.indexOf(parts.weekday!),
    dateKey,
    weekKey: isoWeekKey(dateKey),
  };
}

/** Calendar arithmetic on a `YYYY-MM-DD` key, independent of any zone. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

/** ISO-8601 week (Monday-based, week 1 contains Jan 4) of a `YYYY-MM-DD` key. */
export function isoWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of this week; its year is the ISO year.
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * How late a digest may still go out after its scheduled hour. Covers a
 * missed hourly tick, and lets Vercel Hobby's single daily cron (fired at
 * one UTC hour) serve a morning plan in zones within this many hours of
 * it — the plan at 9 instead of 7 beats no plan.
 */
export const MAX_LATE_HOURS = 6;

export interface DueDigest {
  kind: DigestKind;
  /** Idempotency period: local date for daily kinds, ISO week for the weekly review. */
  periodKey: string;
}

/** Hours elapsed since `sendHour` on the local clock, modulo a day. */
export function hoursSince(localHour: number, sendHour: number): number {
  return (localHour - sendHour + 24) % 24;
}

/**
 * Which digests are due for this user at `now`: enabled, past their
 * (quiet-hours-adjusted) send hour, and not more than `MAX_LATE_HOURS`
 * late. The ledger decides whether a due digest was already sent.
 */
export function dueDigests(prefs: NotificationPreferencesInput, now: Date): DueDigest[] {
  const local = localTime(now, prefs.timezone);
  const inWindow = (scheduledHour: number) =>
    hoursSince(local.hour, effectiveSendHour(prefs, scheduledHour)) <= MAX_LATE_HOURS;

  const out: DueDigest[] = [];
  if (prefs.morningPlanEnabled && inWindow(prefs.morningPlanHour)) {
    out.push({ kind: "morning_plan", periodKey: local.dateKey });
  }
  if (prefs.dueRemindersEnabled && inWindow(prefs.dueReminderHour)) {
    out.push({ kind: "due_reminder", periodKey: local.dateKey });
  }
  if (
    prefs.weeklyReviewEnabled &&
    local.dayOfWeek === prefs.weeklyReviewDay &&
    inWindow(prefs.morningPlanHour)
  ) {
    out.push({ kind: "weekly_review", periodKey: local.weekKey });
  }
  return out;
}
