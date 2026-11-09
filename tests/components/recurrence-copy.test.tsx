// @vitest-environment jsdom
import { useRecurrenceCopy } from "@/components/tasks/task-copy";
import type { Locale } from "@/lib/i18n/config";
import { renderHook } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it } from "vitest";
import { IntlProvider } from "../helpers/intl";

function copy(locale: Locale = "en") {
  const { result } = renderHook(() => useRecurrenceCopy(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <IntlProvider locale={locale}>{children}</IntlProvider>
    ),
  });
  return result.current;
}

describe("useRecurrenceCopy", () => {
  it("describes rules in plain words", () => {
    const { describe: d, title } = copy();
    expect(d({ freq: "daily", mode: "fixed" })).toBe("Daily");
    expect(d({ freq: "weekdays", mode: "after_completion" })).toBe("Weekdays · after completion");
    expect(d({ freq: "weekly", mode: "fixed", weekdays: [4, 1] })).toBe("Weekly on Mon, Thu");
    expect(d({ freq: "monthly", mode: "fixed", dayOfMonth: 22 })).toBe("Monthly on the 22nd");
    expect(d({ freq: "monthly", mode: "fixed", dayOfMonth: 11 })).toBe("Monthly on the 11th");
    expect(d({ freq: "monthly", mode: "fixed", dayOfMonth: 1 })).toBe("Monthly on the 1st");
    expect(title({ freq: "weekly", mode: "fixed", weekdays: [5] })).toBe("Repeats weekly on Fri");
    expect(title({ freq: "daily", mode: "after_completion" })).toBe(
      "Repeats daily · after completion",
    );
  });

  it("describes rules in Spanish", () => {
    const { describe: d, title } = copy("es");
    expect(d({ freq: "daily", mode: "fixed" })).toBe("Diario");
    expect(d({ freq: "weekdays", mode: "after_completion" })).toBe("Entre semana · al completarse");
    expect(d({ freq: "weekly", mode: "fixed", weekdays: [4, 1] })).toBe("Semanal: lun y jue");
    expect(d({ freq: "monthly", mode: "fixed", dayOfMonth: 22 })).toBe("Mensual, el día 22");
    expect(title({ freq: "weekly", mode: "fixed", weekdays: [5] })).toBe(
      "Se repite cada semana: vie",
    );
  });
});
