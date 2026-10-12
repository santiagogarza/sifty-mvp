import { describeSnooze, presetForKey, resolveSnooze } from "@/lib/domain/snooze";
import { describe, expect, it } from "vitest";

/**
 * SIF-9: snooze targets resolve in local calendar days. The DST cases use
 * US transition dates; under any TZ the wall-clock day must still advance
 * by exactly one calendar day (tomorrow) or land on a Monday (next week).
 */

const local = (y: number, m: number, d: number, h = 22) => new Date(y, m - 1, d, h, 30);

describe("resolveSnooze", () => {
  it("tomorrow is the next calendar day, even late in the evening", () => {
    expect(resolveSnooze("tomorrow", local(2026, 10, 14, 23))).toBe("2026-10-15");
    expect(resolveSnooze("tomorrow", local(2026, 10, 31))).toBe("2026-11-01");
    expect(resolveSnooze("tomorrow", local(2026, 12, 31))).toBe("2027-01-01");
  });

  it("next week is the coming Monday from mid-week", () => {
    // 2026-10-14 is a Wednesday.
    expect(resolveSnooze("next_week", local(2026, 10, 14))).toBe("2026-10-19");
  });

  it("next week from a Sunday is tomorrow (the Monday)", () => {
    // 2026-10-18 is a Sunday.
    expect(resolveSnooze("next_week", local(2026, 10, 18))).toBe("2026-10-19");
  });

  it("next week from a Monday is seven days out, not today", () => {
    // 2026-10-19 is a Monday.
    expect(resolveSnooze("next_week", local(2026, 10, 19))).toBe("2026-10-26");
  });

  it("holds the wall-clock day across DST spring-forward", () => {
    // US spring-forward 2026-03-08 (Sunday). Saturday before → Sunday.
    expect(resolveSnooze("tomorrow", local(2026, 3, 7))).toBe("2026-03-08");
    expect(resolveSnooze("next_week", local(2026, 3, 7))).toBe("2026-03-09");
  });

  it("holds the wall-clock day across DST fall-back", () => {
    // US fall-back 2026-11-01 (Sunday). Saturday before → Sunday; Monday is the 2nd.
    expect(resolveSnooze("tomorrow", local(2026, 10, 31))).toBe("2026-11-01");
    expect(resolveSnooze("next_week", local(2026, 10, 31))).toBe("2026-11-02");
    expect(resolveSnooze("next_week", local(2026, 11, 1))).toBe("2026-11-02");
  });

  it("always lands next_week on a Monday", () => {
    for (let day = 1; day <= 31; day++) {
      const [y, m, d] = resolveSnooze("next_week", local(2026, 10, day))
        .split("-")
        .map(Number);
      expect(new Date(y!, m! - 1, d!).getDay()).toBe(1);
    }
  });
});

describe("describeSnooze / presetForKey", () => {
  it("describes the resolved day with weekday and date", () => {
    expect(describeSnooze("tomorrow", local(2026, 10, 14))).toMatch(/Thu/);
    expect(describeSnooze("next_week", local(2026, 10, 14))).toMatch(/Mon/);
  });

  it("maps the list keys", () => {
    expect(presetForKey("t")).toBe("tomorrow");
    expect(presetForKey("w")).toBe("next_week");
    expect(presetForKey("x")).toBeNull();
  });
});
