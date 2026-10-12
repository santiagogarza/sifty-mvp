import { formatRelativeDay, isOverdue, isToday, parseDay } from "@/lib/utils/dates";
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
