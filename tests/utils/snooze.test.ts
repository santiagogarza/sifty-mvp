import {
  formatSnoozeTime,
  isSnoozed,
  normalizeMorningHour,
  resolveSnooze,
  snoozeFromDateInput,
} from "@/lib/utils/snooze";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Pinned to a zone with DST so the transition cases are real. In 2026 US
// clocks spring forward on Sun Mar 8 and fall back on Sun Nov 1.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

/** Local wall-clock date (month is 1-based for readability). */
function local(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min);
}

function wallClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

describe("resolveSnooze", () => {
  it("mid-week: tomorrow is the next morning, next week is the coming Monday", () => {
    const wed = local(2026, 9, 30, 14, 30);
    expect(wallClock(resolveSnooze("tomorrow", wed))).toBe("2026-10-01 09:00");
    expect(wallClock(resolveSnooze("next_week", wed))).toBe("2026-10-05 09:00");
  });

  it("Sunday: next week is the following day", () => {
    const sun = local(2026, 10, 4, 20);
    expect(wallClock(resolveSnooze("tomorrow", sun))).toBe("2026-10-05 09:00");
    expect(wallClock(resolveSnooze("next_week", sun))).toBe("2026-10-05 09:00");
  });

  it("Monday: next week is 7 days out, never today", () => {
    const earlyMon = local(2026, 10, 5, 6);
    expect(wallClock(resolveSnooze("next_week", earlyMon))).toBe("2026-10-12 09:00");
    const lateMon = local(2026, 10, 5, 23, 59);
    expect(wallClock(resolveSnooze("next_week", lateMon))).toBe("2026-10-12 09:00");
  });

  it("Saturday: next week skips Sunday to Monday", () => {
    expect(wallClock(resolveSnooze("next_week", local(2026, 10, 3, 11)))).toBe("2026-10-05 09:00");
  });

  it("rolls over month and year boundaries", () => {
    const nye = local(2026, 12, 31, 18);
    expect(wallClock(resolveSnooze("tomorrow", nye))).toBe("2027-01-01 09:00");
    expect(wallClock(resolveSnooze("next_week", nye))).toBe("2027-01-04 09:00");
  });

  it("DST spring-forward: Saturday before still lands on 9:00 AM local", () => {
    const sat = local(2026, 3, 7, 22);
    const tomorrow = resolveSnooze("tomorrow", sat);
    const nextWeek = resolveSnooze("next_week", sat);
    expect(wallClock(tomorrow)).toBe("2026-03-08 09:00");
    expect(wallClock(nextWeek)).toBe("2026-03-09 09:00");
    // 9:00 EDT (UTC-4), not 9:00 EST shifted by an hour.
    expect(tomorrow.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(nextWeek.toISOString()).toBe("2026-03-09T13:00:00.000Z");
    // Sat 10 PM -> Sun 9 AM is 11 wall-clock hours but only 10 elapsed.
    expect(tomorrow.getTime() - sat.getTime()).toBe(10 * 60 * 60 * 1000);
  });

  it("DST fall-back: Saturday before still lands on 9:00 AM local", () => {
    const sat = local(2026, 10, 31, 22);
    const tomorrow = resolveSnooze("tomorrow", sat);
    const nextWeek = resolveSnooze("next_week", sat);
    expect(wallClock(tomorrow)).toBe("2026-11-01 09:00");
    expect(wallClock(nextWeek)).toBe("2026-11-02 09:00");
    // 9:00 EST (UTC-5).
    expect(tomorrow.toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(nextWeek.toISOString()).toBe("2026-11-02T14:00:00.000Z");
    // 11 wall-clock hours, 12 elapsed.
    expect(tomorrow.getTime() - sat.getTime()).toBe(12 * 60 * 60 * 1000);
  });

  it("honors the morning-hour override", () => {
    const wed = local(2026, 9, 30, 14);
    expect(wallClock(resolveSnooze("tomorrow", wed, 7))).toBe("2026-10-01 07:00");
    expect(wallClock(resolveSnooze("next_week", wed, 11))).toBe("2026-10-05 11:00");
  });

  it("falls back to 9 for out-of-range morning hours", () => {
    expect(normalizeMorningHour(2)).toBe(9);
    expect(normalizeMorningHour(13)).toBe(9);
    expect(normalizeMorningHour(undefined)).toBe(9);
    expect(normalizeMorningHour(6)).toBe(6);
    expect(wallClock(resolveSnooze("tomorrow", local(2026, 9, 30), 2))).toBe("2026-10-01 09:00");
  });
});

describe("formatSnoozeTime", () => {
  it("renders weekday and time with plain spaces", () => {
    expect(formatSnoozeTime(local(2026, 10, 1, 9), "en-US")).toBe("Thu 9:00 AM");
    expect(formatSnoozeTime(local(2026, 10, 5, 12), "en-US")).toBe("Mon 12:00 PM");
  });
});

describe("snoozeFromDateInput", () => {
  it("resolves a date input value to the morning hour that local day", () => {
    expect(wallClock(snoozeFromDateInput("2026-03-08", 9)!)).toBe("2026-03-08 09:00");
    expect(snoozeFromDateInput("", 9)).toBeNull();
    expect(snoozeFromDateInput("not-a-date", 9)).toBeNull();
  });
});

describe("isSnoozed", () => {
  it("is true only while snoozedUntil is in the future", () => {
    const now = local(2026, 9, 30, 12);
    expect(isSnoozed({ snoozedUntil: null }, now)).toBe(false);
    expect(isSnoozed({ snoozedUntil: local(2026, 10, 1, 9).toISOString() }, now)).toBe(true);
    expect(isSnoozed({ snoozedUntil: local(2026, 9, 30, 11).toISOString() }, now)).toBe(false);
  });
});
