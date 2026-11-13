import {
  formatRelativeDay,
  formatTimeAgo,
  isOverdue,
  isToday,
  nextWeekSnoozeDate,
  parseDay,
  toDateOnly,
  tomorrowDate,
  weekendSnoozeDate,
} from "@/lib/utils/dates";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Due dates are day-only strings meaning a local calendar day. West of
 * UTC, parsing them as ISO would land on the previous evening and show a
 * Tomorrow snooze as "Today" (or a Today due as overdue). Node applies a
 * runtime `TZ` change to new Date objects, so the suite pins a US zone.
 */

// Node resets its zone cache on direct assignment to process.env.TZ
// (vi.stubEnv does not trigger that hook).
const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});

afterAll(() => {
  if (originalTz === undefined) {
    // biome-ignore lint/performance/noDelete: TZ must be unset, not empty, to restore the system zone.
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("day-only due dates in a west-of-UTC zone", () => {
  // Monday 2026-10-12, late evening local time.
  const now = new Date(2026, 9, 12, 22, 30);

  it("parseDay resolves YYYY-MM-DD as local midnight", () => {
    const d = parseDay("2026-10-13");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 13, 0]);
    // Full timestamps still parse as instants.
    expect(parseDay("2026-10-13T12:00:00.000Z").toISOString()).toBe("2026-10-13T12:00:00.000Z");
  });

  it("tomorrow is Tomorrow, today is Today, and today is not overdue", () => {
    expect(formatRelativeDay("2026-10-13", now)).toBe("Tomorrow");
    expect(formatRelativeDay("2026-10-12", now)).toBe("Today");
    expect(isToday("2026-10-12", now)).toBe(true);
    expect(isOverdue("2026-10-12", now)).toBe(false);
    expect(isOverdue("2026-10-11", now)).toBe(true);
  });

  it("the ISO parse it replaces would have been a day early", () => {
    const wrong = new Date("2026-10-13");
    expect(wrong.getDate()).toBe(12);
  });
});

describe("snooze presets stay on the local calendar", () => {
  // Built inside each test: a date created while collecting the file would
  // still be in the process zone, before the suite pins Pacific time.
  // Friday 2026-11-13, late evening. In a US zone this instant is already Saturday in UTC.
  const fridayEvening = () => new Date(2026, 10, 13, 20, 30);

  it("tomorrow does not slip a day when the UTC date is already ahead", () => {
    const evening = fridayEvening();
    expect(evening.toISOString().slice(0, 10)).toBe("2026-11-14");
    expect(toDateOnly(evening)).toBe("2026-11-13");
    expect(tomorrowDate(evening)).toBe("2026-11-14");
    const slipped = new Date(evening);
    slipped.setDate(slipped.getDate() + 1);
    expect(slipped.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(tomorrowDate(evening)).not.toBe(slipped.toISOString().slice(0, 10));
  });

  it("weekend is the coming Saturday, Sunday on Saturday, and hidden on Sunday", () => {
    expect(weekendSnoozeDate(fridayEvening())).toBe("2026-11-14");
    expect(weekendSnoozeDate(new Date(2026, 10, 14, 20, 30))).toBe("2026-11-15");
    expect(weekendSnoozeDate(new Date(2026, 10, 15, 20, 30))).toBeNull();
  });

  it("next week is the next Monday and never today", () => {
    expect(nextWeekSnoozeDate(fridayEvening())).toBe("2026-11-16");
    expect(nextWeekSnoozeDate(new Date(2026, 10, 15, 20, 30))).toBe("2026-11-16");
    expect(nextWeekSnoozeDate(new Date(2026, 10, 16, 20, 30))).toBe("2026-11-23");
  });
});

describe("formatTimeAgo", () => {
  const now = new Date(2026, 9, 12, 15, 0);

  it("counts up from just now through minutes and hours within the day", () => {
    expect(formatTimeAgo(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(formatTimeAgo(new Date(now.getTime() - 12 * 60_000), now)).toBe("12m ago");
    expect(formatTimeAgo(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3h ago");
    // Clocks that disagree never produce a negative age.
    expect(formatTimeAgo(new Date(now.getTime() + 60_000), now)).toBe("just now");
  });

  it("falls back to the relative day once the day boundary is crossed", () => {
    expect(formatTimeAgo(new Date(2026, 9, 11, 23, 30), now)).toBe("Yesterday");
    expect(formatTimeAgo(new Date(2026, 9, 8, 9, 0), now)).toBe("4 days ago");
    expect(formatTimeAgo("2026-09-01T09:00:00.000Z", now)).toMatch(/Sep 1/);
  });

  it("is empty for an unparsable timestamp", () => {
    expect(formatTimeAgo("not a date", now)).toBe("");
  });
});
