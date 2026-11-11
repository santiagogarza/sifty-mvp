import {
  isSnoozed,
  isValidSnoozeDate,
  localIsoDate,
  parseLocalIsoDate,
  snoozeDateFor,
} from "@/lib/domain/snooze";
import { describe, expect, it } from "vitest";

/** Local dates in the week of Mon Nov 9 – Sun Nov 15, 2026. */
function day(date: number, hours = 10): Date {
  return new Date(2026, 10, date, hours, 0, 0);
}

describe("snoozeDateFor", () => {
  // [weekday, date, this weekend, next week]
  const week: Array<[string, number, string, string]> = [
    ["Mon", 9, "2026-11-14", "2026-11-16"],
    ["Tue", 10, "2026-11-14", "2026-11-16"],
    ["Wed", 11, "2026-11-14", "2026-11-16"],
    ["Thu", 12, "2026-11-14", "2026-11-16"],
    ["Fri", 13, "2026-11-14", "2026-11-16"],
    ["Sat", 14, "2026-11-21", "2026-11-16"],
    ["Sun", 15, "2026-11-21", "2026-11-16"],
  ];

  for (const [weekday, date, weekend, nextWeek] of week) {
    it(`resolves presets on a ${weekday}`, () => {
      const now = day(date);
      expect(snoozeDateFor("tomorrow", now)).toBe(localIsoDate(day(date + 1)));
      expect(snoozeDateFor("weekend", now)).toBe(weekend);
      expect(snoozeDateFor("next_week", now)).toBe(nextWeek);
    });
  }

  it("stays in local time late in the evening (no UTC slip)", () => {
    expect(snoozeDateFor("tomorrow", day(9, 23))).toBe("2026-11-10");
    expect(snoozeDateFor("tomorrow", day(9, 0))).toBe("2026-11-10");
  });

  it("crosses month and year boundaries", () => {
    expect(snoozeDateFor("tomorrow", new Date(2026, 11, 31, 18))).toBe("2027-01-01");
    // Thu Dec 31 2026 → Sat Jan 2 / Mon Jan 4.
    expect(snoozeDateFor("weekend", new Date(2026, 11, 31, 18))).toBe("2027-01-02");
    expect(snoozeDateFor("next_week", new Date(2026, 11, 31, 18))).toBe("2027-01-04");
  });
});

describe("isSnoozed", () => {
  it("is true before the wake day and false from the wake day on", () => {
    const task = { snoozedUntil: "2026-11-14" };
    expect(isSnoozed(task, day(13, 23))).toBe(true);
    expect(isSnoozed(task, day(14, 0))).toBe(false);
    expect(isSnoozed(task, day(15))).toBe(false);
  });

  it("is false when there is no wake day", () => {
    expect(isSnoozed({ snoozedUntil: null }, day(9))).toBe(false);
  });
});

describe("custom snooze dates", () => {
  it("only accepts days after today", () => {
    const now = day(9);
    expect(isValidSnoozeDate("2026-11-10", now)).toBe(true);
    expect(isValidSnoozeDate("2026-11-09", now)).toBe(false);
    expect(isValidSnoozeDate("2026-11-01", now)).toBe(false);
    expect(isValidSnoozeDate("", now)).toBe(false);
    expect(isValidSnoozeDate("not-a-date", now)).toBe(false);
  });

  it("parses ISO days as local midnight", () => {
    const d = parseLocalIsoDate("2026-11-14");
    expect(d?.getDate()).toBe(14);
    expect(d?.getHours()).toBe(0);
  });
});
