import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import {
  MAX_LATE_HOURS,
  addDays,
  dueDigests,
  hoursSince,
  isoWeekKey,
  localTime,
} from "@/lib/notifications/schedule";
import { describe, expect, it } from "vitest";

const prefs = (over: Partial<typeof DEFAULT_PREFERENCES> = {}) => ({
  ...DEFAULT_PREFERENCES,
  ...over,
});

describe("localTime", () => {
  it("resolves wall-clock fields in the requested zone", () => {
    // 2026-10-12T05:30Z is 07:30 in Ljubljana (CEST, UTC+2) and 01:30 in New York (EDT).
    const now = new Date("2026-10-12T05:30:00Z");
    expect(localTime(now, "Europe/Ljubljana")).toMatchObject({
      hour: 7,
      minute: 30,
      dayOfWeek: 1,
      dateKey: "2026-10-12",
      weekKey: "2026-W42",
    });
    expect(localTime(now, "America/New_York")).toMatchObject({
      hour: 1,
      dateKey: "2026-10-12",
    });
    // Sydney is already Monday evening; Honolulu is still Sunday.
    expect(localTime(now, "Australia/Sydney")).toMatchObject({ hour: 16, dateKey: "2026-10-12" });
    expect(localTime(now, "Pacific/Honolulu")).toMatchObject({
      hour: 19,
      dayOfWeek: 0,
      dateKey: "2026-10-11",
    });
  });

  it("follows DST: 7 am New York is 11Z in summer and 12Z in winter", () => {
    expect(localTime(new Date("2026-07-01T11:00:00Z"), "America/New_York").hour).toBe(7);
    expect(localTime(new Date("2026-12-01T12:00:00Z"), "America/New_York").hour).toBe(7);
    // Spring forward (2026-03-08): the 7 am slot moves from 12Z to 11Z overnight.
    expect(localTime(new Date("2026-03-07T12:00:00Z"), "America/New_York").hour).toBe(7);
    expect(localTime(new Date("2026-03-08T11:00:00Z"), "America/New_York").hour).toBe(7);
    // Fall back (2026-11-01): 7 am is 11Z the day before and 12Z after.
    expect(localTime(new Date("2026-10-31T11:00:00Z"), "America/New_York").hour).toBe(7);
    expect(localTime(new Date("2026-11-01T12:00:00Z"), "America/New_York").hour).toBe(7);
    // Europe moves on 2026-03-29 / 2026-10-25.
    expect(localTime(new Date("2026-03-28T06:00:00Z"), "Europe/Ljubljana").hour).toBe(7);
    expect(localTime(new Date("2026-03-29T05:00:00Z"), "Europe/Ljubljana").hour).toBe(7);
    expect(localTime(new Date("2026-10-24T05:00:00Z"), "Europe/Ljubljana").hour).toBe(7);
    expect(localTime(new Date("2026-10-25T06:00:00Z"), "Europe/Ljubljana").hour).toBe(7);
  });

  it("never reports hour 24 at midnight", () => {
    expect(localTime(new Date("2026-10-12T00:00:00Z"), "UTC").hour).toBe(0);
    expect(localTime(new Date("2026-10-11T22:00:00Z"), "Europe/Ljubljana").hour).toBe(0);
  });
});

describe("date keys", () => {
  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-10-12", -7)).toBe("2026-10-05");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("isoWeekKey follows ISO 8601 (Monday weeks, week 1 holds Jan 4)", () => {
    expect(isoWeekKey("2026-10-12")).toBe("2026-W42");
    expect(isoWeekKey("2026-10-11")).toBe("2026-W41");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
  });
});

describe("dueDigests", () => {
  it("is due from the send hour until MAX_LATE_HOURS after it, in the user's zone", () => {
    const p = prefs({ timezone: "Europe/Ljubljana", morningPlanHour: 7, dueReminderHour: 15 });
    // Monday 2026-10-12, CEST. 04:00Z = 06:00 local: not yet.
    expect(dueDigests(p, new Date("2026-10-12T04:00:00Z"))).toEqual([]);
    // 05:00Z = 07:00 local: morning plan due.
    expect(dueDigests(p, new Date("2026-10-12T05:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
    // 11:00Z = 13:00 local: 6 hours late, still inside the window.
    expect(dueDigests(p, new Date("2026-10-12T11:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
    expect(hoursSince(13, 7)).toBe(MAX_LATE_HOURS);
    // 12:00Z = 14:00 local: morning window closed, afternoon not open.
    expect(dueDigests(p, new Date("2026-10-12T12:00:00Z"))).toEqual([]);
    // 13:00Z = 15:00 local: due reminder.
    expect(dueDigests(p, new Date("2026-10-12T13:00:00Z"))).toEqual([
      { kind: "due_reminder", periodKey: "2026-10-12" },
    ]);
    // 20:00Z = 22:00 local: 7 hours late for the reminder, window closed.
    expect(dueDigests(p, new Date("2026-10-12T20:00:00Z"))).toEqual([]);
  });

  it("serves the same local hour on both sides of a DST change", () => {
    const p = prefs({
      timezone: "America/New_York",
      morningPlanHour: 7,
      weeklyReviewEnabled: false,
    });
    expect(dueDigests(p, new Date("2026-03-07T12:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-03-07" },
    ]);
    expect(dueDigests(p, new Date("2026-03-08T11:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-03-08" },
    ]);
    // 2026-03-08T12:00Z is 08:00 EDT: still the same local day, one hour late.
    expect(dueDigests(p, new Date("2026-03-08T12:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-03-08" },
    ]);
  });

  it("adds the weekly review only on the chosen weekday, keyed by ISO week", () => {
    const sunday = prefs({ timezone: "UTC", weeklyReviewDay: 0, morningPlanHour: 7 });
    expect(dueDigests(sunday, new Date("2026-10-11T07:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-11" },
      { kind: "weekly_review", periodKey: "2026-W41" },
    ]);
    expect(dueDigests(sunday, new Date("2026-10-12T07:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
  });

  it("respects the enabled flags", () => {
    const off = prefs({
      timezone: "UTC",
      morningPlanEnabled: false,
      dueRemindersEnabled: false,
      weeklyReviewEnabled: false,
    });
    expect(dueDigests(off, new Date("2026-10-11T07:00:00Z"))).toEqual([]);
    expect(dueDigests(off, new Date("2026-10-11T15:00:00Z"))).toEqual([]);
  });

  it("never fires today's digest before today's send hour, even for late schedules", () => {
    // 22:00 send hour: 02:00 is not "4 hours after yesterday's 22:00".
    const late = prefs({
      timezone: "UTC",
      morningPlanHour: 22,
      dueRemindersEnabled: false,
      weeklyReviewEnabled: false,
    });
    expect(hoursSince(2, 22)).toBe(-20);
    expect(dueDigests(late, new Date("2026-10-12T02:00:00Z"))).toEqual([]);
    expect(dueDigests(late, new Date("2026-10-12T21:59:00Z"))).toEqual([]);
    expect(dueDigests(late, new Date("2026-10-12T22:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
    expect(dueDigests(late, new Date("2026-10-12T23:30:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
    // Next day 00:00–04:00 would be "late" for the 12th, but the period key
    // is now the 13th and its send hour has not come.
    expect(dueDigests(late, new Date("2026-10-13T01:00:00Z"))).toEqual([]);
  });

  it("quiet hours push the morning plan to the end of the window", () => {
    const p = prefs({ timezone: "UTC", morningPlanHour: 7, quietHoursStart: 22, quietHoursEnd: 9 });
    expect(dueDigests(p, new Date("2026-10-12T07:00:00Z"))).toEqual([]);
    expect(dueDigests(p, new Date("2026-10-12T08:59:00Z"))).toEqual([]);
    expect(dueDigests(p, new Date("2026-10-12T09:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-10-12" },
    ]);
  });

  it("a Hobby daily tick at 06:00Z serves Central Europe in both summer and winter", () => {
    const p = prefs({ timezone: "Europe/Ljubljana", morningPlanHour: 7 });
    // July: 06:00Z = 08:00 CEST (1h late). December: 06:00Z = 07:00 CET.
    expect(dueDigests(p, new Date("2026-07-06T06:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-07-06" },
    ]);
    expect(dueDigests(p, new Date("2026-12-07T06:00:00Z"))).toEqual([
      { kind: "morning_plan", periodKey: "2026-12-07" },
    ]);
  });
});
