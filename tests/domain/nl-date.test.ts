import { describeDay, parseNaturalDate, stripMatch } from "@/lib/domain/nl-date";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Natural-language due dates resolve in the user's local calendar. Each
 * case pins `now` (a local wall-clock moment) and often the process zone,
 * so DST changes and week/month/year boundaries are exercised for real.
 */

const originalTz = process.env.TZ;

afterEach(() => {
  // Node re-reads TZ on assignment; an undefined assignment restores the host zone.
  process.env.TZ = originalTz;
});

function inZone(tz: string, fn: () => void) {
  process.env.TZ = tz;
  fn();
}

function at(y: number, m: number, d: number, h = 9, min = 0): Date {
  return new Date(y, m - 1, d, h, min);
}

function due(text: string, now: Date): string | null {
  return parseNaturalDate(text, now)?.due ?? null;
}

describe("parseNaturalDate: relative words", () => {
  // Mon 2026-10-12.
  const now = at(2026, 10, 12, 21, 30);

  it("today / tonight / tomorrow / day after tomorrow", () => {
    expect(due("Pay rent today", now)).toBe("2026-10-12");
    expect(due("Finish slides tonight", now)).toBe("2026-10-12");
    expect(due("Call the dentist tomorrow", now)).toBe("2026-10-13");
    expect(due("Call the dentist tmrw", now)).toBe("2026-10-13");
    expect(due("Submit expenses the day after tomorrow", now)).toBe("2026-10-14");
  });

  it("this weekend is Saturday", () => {
    expect(due("Clean the garage this weekend", now)).toBe("2026-10-17");
  });

  it("next week is the coming Monday, matching the snooze shortcut", () => {
    expect(due("Plan Q4 next week", now)).toBe("2026-10-19"); // from a Monday: +7
    expect(due("Plan Q4 next week", at(2026, 10, 15))).toBe("2026-10-19"); // from a Thursday
    expect(due("Plan Q4 next week", at(2026, 10, 18))).toBe("2026-10-19"); // from a Sunday
  });

  it("next month is the first of next month", () => {
    expect(due("Review budget next month", now)).toBe("2026-11-01");
  });

  it("in N days / weeks / months, digits and words", () => {
    expect(due("Follow up in 3 days", now)).toBe("2026-10-15");
    expect(due("Follow up in two weeks", now)).toBe("2026-10-26");
    expect(due("Follow up in 2 weeks", now)).toBe("2026-10-26");
    expect(due("Follow up in a week", now)).toBe("2026-10-19");
    expect(due("Renew passport in 6 months", now)).toBe("2027-04-12");
  });

  it("end of week / month / year and abbreviations", () => {
    expect(due("Send the report end of week", now)).toBe("2026-10-16");
    expect(due("Send the report by EOW", now)).toBe("2026-10-16");
    expect(due("Close the books end of month", now)).toBe("2026-10-31");
    expect(due("Close the books eom", now)).toBe("2026-10-31");
    expect(due("Taxes end of year", now)).toBe("2026-12-31");
    // Already past Friday: end of week rolls to next Friday.
    expect(due("Send it end of week", at(2026, 10, 17))).toBe("2026-10-23");
    // On the last day of the month "end of month" is today.
    expect(due("Invoice end of month", at(2026, 10, 31))).toBe("2026-10-31");
  });

  it("this weekend on a weekend day is today", () => {
    expect(due("Clean the garage this weekend", at(2026, 10, 17))).toBe("2026-10-17"); // Saturday
    expect(due("Clean the garage this weekend", at(2026, 10, 18))).toBe("2026-10-18"); // Sunday
  });

  it("end of year abbreviates too", () => {
    expect(due("Taxes by eoy", now)).toBe("2026-12-31");
  });

  it("returns null when nothing reads as a date", () => {
    expect(parseNaturalDate("Buy flowers for mom", now)).toBeNull();
    expect(parseNaturalDate("Read the Monday's-child poem", now)).toBeNull();
    expect(parseNaturalDate("I sat with Bob and we talked", now)).toBeNull();
    expect(parseNaturalDate("Buy 1/2 lb of coffee", now)).toBeNull();
    expect(parseNaturalDate("", now)).toBeNull();
  });

  it("possessives name a thing, not a deadline", () => {
    for (const text of [
      "Prep for tomorrow's standup",
      "Prep for tomorrow’s standup",
      "Read today's digest",
      "Plan next week's menu",
      "Review next month's budget",
      "Pack for this weekend's trip",
      "Summarize end of month's numbers",
      "Book next Friday's room",
      "Check Monday's notes",
    ]) {
      expect(parseNaturalDate(text, now), text).toBeNull();
    }
    // …but a real deadline next to a possessive still parses, and strips cleanly.
    const m = parseNaturalDate("Prep for tomorrow's standup by Friday", now)!;
    expect(m.text).toBe("by Friday");
    expect(stripMatch("Prep for tomorrow's standup by Friday", m)).toBe(
      "Prep for tomorrow's standup",
    );
  });
});

describe("parseNaturalDate: weekdays", () => {
  // Wed 2026-10-14.
  const now = at(2026, 10, 14);

  it("a bare weekday is the next occurrence, today included", () => {
    expect(due("Dentist Friday", now)).toBe("2026-10-16");
    expect(due("Dentist on friday", now)).toBe("2026-10-16");
    expect(due("Dentist this Friday", now)).toBe("2026-10-16");
    expect(due("Standup Wednesday", now)).toBe("2026-10-14");
    expect(due("Groceries Monday", now)).toBe("2026-10-19");
  });

  it("next <weekday> means next week's", () => {
    expect(due("Dentist next Friday", now)).toBe("2026-10-23");
    expect(due("Dentist next Monday", now)).toBe("2026-10-19");
    expect(due("Standup next Wednesday", now)).toBe("2026-10-21");
    // On Sunday the week has ended; "next Monday" is tomorrow.
    expect(due("Groceries next Monday", at(2026, 10, 18))).toBe("2026-10-19");
  });

  it("last <weekday> is history, not a deadline", () => {
    expect(parseNaturalDate("Call Ana about last Friday", now)).toBeNull();
    expect(parseNaturalDate("Call Ana about last  Friday", now)).toBeNull(); // any whitespace
    // A time attached to history is not a deadline for today either.
    expect(parseNaturalDate("Call Ana about last Friday 3pm", now)).toBeNull();
    expect(parseNaturalDate("Meet by 1/2 at 3pm", now)).toBeNull();
    expect(parseNaturalDate("Finish what we did last month", now)).toBeNull();
    expect(parseNaturalDate("Review last week's notes", now)).toBeNull();
    // …while a later deadline still parses.
    expect(parseNaturalDate("Follow up on last Friday's call by Monday", now)).toMatchObject({
      due: "2026-10-19",
      text: "by Monday",
    });
  });

  it("abbreviations only after a preposition", () => {
    expect(due("Ship it by fri", now)).toBe("2026-10-16");
    expect(due("Ship it on thurs", now)).toBe("2026-10-15");
    expect(due("Ship it this sat", now)).toBe("2026-10-17");
    expect(parseNaturalDate("fri night pizza", now)).toBeNull();
  });
});

describe("parseNaturalDate: explicit dates", () => {
  const now = at(2026, 10, 12);

  it("month-day in both orders, with ordinals and years", () => {
    expect(due("Taxes Oct 15", now)).toBe("2026-10-15");
    expect(due("Taxes October 15th", now)).toBe("2026-10-15");
    expect(due("Taxes on 15 Oct", now)).toBe("2026-10-15");
    expect(due("Taxes 15th of October", now)).toBe("2026-10-15");
    expect(due("Taxes Oct 15, 2027", now)).toBe("2027-10-15");
    expect(due("Taxes sept. 3", now)).toBe("2027-09-03");
  });

  it("the Nth of a month is the whole phrase, not a bare ordinal", () => {
    const m = parseNaturalDate("Pay rent on the 15th of November", now)!;
    expect(m.due).toBe("2026-11-15");
    expect(m.text).toBe("on the 15th of November");
    expect(stripMatch("Pay rent on the 15th of November", m)).toBe("Pay rent");
    expect(parseNaturalDate("Pay rent by the 1st of December", now)).toMatchObject({
      due: "2026-12-01",
      text: "by the 1st of December",
    });
  });

  it("rolls a passed month-day to next year", () => {
    expect(due("Birthday card Jan 5", now)).toBe("2027-01-05");
    expect(due("Birthday card 10/1", now)).toBe("2027-10-01");
  });

  it("slash and ISO dates", () => {
    expect(due("Submit 10/20", now)).toBe("2026-10-20");
    expect(due("Submit by 10/20 at 5pm", now)).toBe("2026-10-20");
    expect(parseNaturalDate("Submit 10/20 at 15:00", now)).toMatchObject({
      due: "2026-10-20",
      time: "15:00",
      text: "10/20 at 15:00",
    });
    expect(parseNaturalDate("Submit 10/20 at noon", now)).toMatchObject({
      due: "2026-10-20",
      time: "noon",
    });
    expect(due("Submit 12/3/26", now)).toBe("2026-12-03");
    expect(due("Submit 2026-11-02", now)).toBe("2026-11-02");
    expect(parseNaturalDate("Submit 13/40", now)).toBeNull();
    expect(parseNaturalDate("Submit 2026-02-30", now)).toBeNull();
    // Fractions, with or without a preposition, and a slash date mid-sentence.
    expect(parseNaturalDate("Split the bill by 1/2", now)).toBeNull();
    expect(parseNaturalDate("Cut by 1/2 of the budget", now)).toBeNull();
    expect(parseNaturalDate("Reduce to 3/4", now)).toBeNull();
    expect(due("Pay by 1/2/2027", now)).toBe("2027-01-02"); // a year makes it a date
    expect(due("Pay by 1/5", now)).toBe("2027-01-05");
    expect(parseNaturalDate("file taxes 10/20 to confirm", now)).toBeNull();
    expect(due("Submit by 10/20", now)).toBe("2026-10-20");
    expect(due("Submit by 10/20.", now)).toBe("2026-10-20");
  });

  it("the Nth is this month, or next once passed", () => {
    expect(due("Rent due on the 15th", now)).toBe("2026-10-15");
    expect(due("Rent due by the 5th", now)).toBe("2026-11-05");
    expect(due("Rent by the 31st", at(2026, 11, 2))).toBe("2026-12-31");
    // Past the Nth in December: January of next year.
    expect(due("Rent due on the 15th", at(2026, 12, 20))).toBe("2027-01-15");
    expect(due("Rent by the 5th", at(2026, 12, 31))).toBe("2027-01-05");
  });
});

describe("parseNaturalDate: times of day", () => {
  const now = at(2026, 10, 12);

  it("keeps the time for display and the day for the due", () => {
    const m = parseNaturalDate("Call Ana tomorrow 3pm", now)!;
    expect(m.due).toBe("2026-10-13");
    expect(m.time).toBe("3pm");
    expect(m.text).toBe("tomorrow 3pm");

    expect(parseNaturalDate("Call Ana tomorrow at 15:30", now)).toMatchObject({
      due: "2026-10-13",
      time: "15:30",
      text: "tomorrow at 15:30",
    });
    expect(parseNaturalDate("Standup Friday morning", now)).toMatchObject({
      due: "2026-10-16",
      time: "morning",
      text: "Friday morning",
    });
    expect(parseNaturalDate("At 9am tomorrow call Ana", now)).toMatchObject({
      due: "2026-10-13",
      time: "9am",
      text: "At 9am tomorrow",
    });
  });

  it("a time alone means today", () => {
    expect(parseNaturalDate("Call Ana at 3pm", now)).toMatchObject({
      due: "2026-10-12",
      time: "3pm",
      text: "at 3pm",
    });
    expect(parseNaturalDate("Call Ana 3pm", now)).toMatchObject({ due: "2026-10-12" });
    // Bare numbers are not times.
    expect(parseNaturalDate("Order 3 chairs", now)).toBeNull();
  });
});

describe("parseNaturalDate: match selection and stripping", () => {
  const now = at(2026, 10, 12);

  it("prefers a phrase with a deadline preposition over an earlier bare one", () => {
    const m = parseNaturalDate("Book flights for Dec 12 by Friday", now)!;
    expect(m.due).toBe("2026-10-16");
    expect(m.text).toBe("by Friday");
  });

  it("otherwise takes the first phrase", () => {
    const m = parseNaturalDate("Friday: prep for the Monday meeting", now)!;
    expect(m.text).toBe("Friday");
    expect(m.due).toBe("2026-10-16");
  });

  it("strips the phrase and the punctuation it leaves behind", () => {
    const strip = (text: string) => stripMatch(text, parseNaturalDate(text, now)!);
    expect(strip("Call the dentist tomorrow")).toBe("Call the dentist");
    expect(strip("Send report by Friday")).toBe("Send report");
    expect(strip("Friday: prep the meeting")).toBe("prep the meeting");
    expect(strip("Pay rent, tomorrow, before noon")).toBe("Pay rent before noon");
    expect(strip("Tomorrow 3pm - call Ana")).toBe("call Ana");
    // Nothing but the date: keep the text rather than produce an empty title.
    expect(strip("tomorrow")).toBe("tomorrow");
  });

  it("describes the day like the snooze toast", () => {
    expect(describeDay("2026-10-16")).toMatch(/Fri/);
    expect(describeDay("2026-10-16")).toMatch(/16/);
  });
});

describe("parseNaturalDate: DST and boundaries", () => {
  it("spring-forward night in New York keeps whole calendar days", () => {
    inZone("America/New_York", () => {
      // Sat Mar 7 2026 at 23:30; DST starts Sun Mar 8 at 02:00.
      const now = at(2026, 3, 7, 23, 30);
      expect(due("tomorrow", now)).toBe("2026-03-08");
      expect(due("in 2 days", now)).toBe("2026-03-09");
      expect(due("Monday", now)).toBe("2026-03-09");
      expect(due("next week", now)).toBe("2026-03-09");
      expect(due("in 1 week", now)).toBe("2026-03-14");
    });
  });

  it("fall-back night in New York does not double a day", () => {
    inZone("America/New_York", () => {
      // Sat Oct 31 2026 at 23:30; DST ends Sun Nov 1 at 02:00.
      const now = at(2026, 10, 31, 23, 30);
      expect(due("tomorrow", now)).toBe("2026-11-01");
      expect(due("in 2 days", now)).toBe("2026-11-02");
      expect(due("end of month", now)).toBe("2026-10-31");
      expect(due("next month", now)).toBe("2026-11-01");
      expect(due("in a month", now)).toBe("2026-11-30"); // Oct 31 + 1 month clamps
    });
  });

  it("European DST change (last Sunday of March) across a week boundary", () => {
    inZone("Europe/Berlin", () => {
      // Fri Mar 27 2026 22:00; clocks jump Sun Mar 29.
      const now = at(2026, 3, 27, 22, 0);
      expect(due("Sunday", now)).toBe("2026-03-29");
      expect(due("next week", now)).toBe("2026-03-30");
      expect(due("next Friday", now)).toBe("2026-04-03");
      expect(due("end of month", now)).toBe("2026-03-31");
    });
  });

  it("southern-hemisphere DST (Auckland) and a year boundary", () => {
    inZone("Pacific/Auckland", () => {
      // Thu Dec 31 2026 at 23:50 (NZDT).
      const now = at(2026, 12, 31, 23, 50);
      expect(due("tomorrow", now)).toBe("2027-01-01");
      expect(due("end of year", now)).toBe("2026-12-31");
      expect(due("next month", now)).toBe("2027-01-01");
      expect(due("Jan 5", now)).toBe("2027-01-05");
      expect(due("next week", now)).toBe("2027-01-04");
      expect(due("in 3 days", now)).toBe("2027-01-03");
    });
  });

  it("late evening west of Greenwich stays on the local day", () => {
    inZone("America/Los_Angeles", () => {
      // 23:00 local is already the next UTC day; the due must not skip ahead.
      const now = at(2026, 10, 12, 23, 0);
      expect(due("today", now)).toBe("2026-10-12");
      expect(due("tomorrow", now)).toBe("2026-10-13");
    });
  });

  it("month-length edges for 'in N months'", () => {
    const now = at(2026, 1, 31);
    expect(due("in 1 month", now)).toBe("2026-02-28");
    expect(due("in 3 months", now)).toBe("2026-04-30");
    expect(due("in 1 month", at(2028, 1, 31))).toBe("2028-02-29");
  });
});
