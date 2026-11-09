import { recurrenceSummary } from "@/lib/domain/recurrence";
import type { Recurrence } from "@/lib/domain/types";
import { useFormatter, useTranslations } from "next-intl";

/** 2023-01-01 was a Sunday, so day `d` of that week is weekday `d` (0 = Sunday). */
const weekdayDate = (d: number) => new Date(Date.UTC(2023, 0, 1 + d));

/** Localized weekday names by `Date#getDay()` index. */
export function useWeekdayName() {
  const format = useFormatter();
  return (day: number, width: "narrow" | "short" | "long") =>
    format.dateTime(weekdayDate(day), { weekday: width, timeZone: "UTC" });
}

/**
 * Recurrence wording: `describe` for the detail sheet ("Weekly on Mon,
 * Thu"), `title` for list rows ("Repeats weekly on Mon, Thu").
 */
export function useRecurrenceCopy() {
  const t = useTranslations("taskDetail.recurrence.describe");
  const format = useFormatter();
  const weekday = useWeekdayName();

  const word = (rule: Recurrence, form: "title" | "describe"): string => {
    const summary = recurrenceSummary(rule);
    switch (summary.kind) {
      case "weeklyOn":
        return t("weeklyOn", {
          form,
          days: format.list(
            summary.weekdays.map((d) => weekday(d, "short")),
            { type: "unit", style: "short" },
          ),
        });
      case "monthlyOn":
        return t("monthlyOn", { form, day: summary.dayOfMonth });
      case "freq": {
        const base = t(summary.freq, { form });
        return summary.afterCompletion ? t("afterCompletion", { base }) : base;
      }
    }
  };

  return {
    describe: (rule: Recurrence) => word(rule, "describe"),
    title: (rule: Recurrence) => word(rule, "title"),
  };
}

/** "Fri, Oct 16" for a local `YYYY-MM-DD` day, in the browser's time zone. */
export function useShortDay() {
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return format.dateTime(new Date(y!, m! - 1, d!), {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    });
  };
}
