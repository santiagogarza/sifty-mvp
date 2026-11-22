import type { SnoozePreset } from "@/lib/domain/snooze";
import { dayDelta, parseDay } from "@/lib/utils/dates";
import { useFormatter, useTranslations } from "next-intl";

/**
 * Localized `formatRelativeDay` / `formatTimeAgo` / `formatExactTime` and
 * snooze preset names, for client components. Same rules as
 * `lib/utils/dates.ts` (relative nearby, absolute beyond a week), in the
 * browser's own time zone like the originals.
 */
export function useDateCopy() {
  const t = useTranslations("common");
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const relativeDay = (
    value: string | Date | null | undefined,
    now = new Date(),
  ): string | null => {
    if (!value) return null;
    const date = parseDay(value);
    if (Number.isNaN(date.getTime())) return null;
    const delta = dayDelta(date, now);
    if (delta === 0) return t("dates.today");
    if (delta === 1) return t("dates.tomorrow");
    if (delta === -1) return t("dates.yesterday");
    if (delta > 1 && delta <= 6) return format.dateTime(date, { weekday: "long", timeZone });
    if (delta < -1 && delta >= -6) return t("dates.daysAgo", { count: -delta });
    const sameYear = date.getFullYear() === now.getFullYear();
    return format.dateTime(date, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
      timeZone,
    });
  };

  const timeAgo = (value: string | Date, now = new Date()): string => {
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
    if (seconds < 60) return t("dates.justNow");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("dates.minutesAgo", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24 && dayDelta(date, now) === 0) return t("dates.hoursAgo", { count: hours });
    return relativeDay(date, now) ?? "";
  };

  const exactTime = (value: string | Date): string =>
    format.dateTime(typeof value === "string" ? new Date(value) : value, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });

  const snooze = (preset: SnoozePreset): string => t(`snooze.${preset}`);

  return { relativeDay, timeAgo, exactTime, snooze };
}
