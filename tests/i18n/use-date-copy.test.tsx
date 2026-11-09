// @vitest-environment jsdom
import { useDateCopy } from "@/lib/i18n/use-date-copy";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlProvider } from "../helpers/intl";

function copy(locale: "en" | "es") {
  return renderHook(() => useDateCopy(), {
    wrapper: ({ children }) => <IntlProvider locale={locale}>{children}</IntlProvider>,
  }).result.current;
}

const now = new Date(2026, 10, 9, 12, 0, 0);

describe("useDateCopy", () => {
  it("matches the English wording of lib/utils/dates", () => {
    const en = copy("en");
    expect(en.relativeDay("2026-11-10", now)).toBe("Tomorrow");
    expect(en.relativeDay("2026-11-06", now)).toBe("3 days ago");
    expect(en.timeAgo(new Date(now.getTime() - 5 * 60_000), now)).toBe("5m ago");
    expect(en.snooze("next_week")).toBe("Next week");
  });

  it("speaks Spanish", () => {
    const es = copy("es");
    expect(es.relativeDay("2026-11-09", now)).toBe("Hoy");
    expect(es.relativeDay("2026-11-08", now)).toBe("Ayer");
    expect(es.relativeDay("2026-11-07", now)).toBe("hace 2 días");
    expect(es.relativeDay("2026-11-12", now)).toBe("jueves");
    expect(es.timeAgo(new Date(now.getTime() - 20_000), now)).toBe("justo ahora");
    expect(es.snooze("tomorrow")).toBe("Mañana");
  });
});
