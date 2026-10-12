import { focusScore } from "@/lib/domain/priority";
import { describe, expect, it } from "vitest";

/**
 * Focus ordering counts due dates in whole calendar days, matching the
 * Overdue/Today badges: a task due today is not overdue at 9pm.
 */

const base = { bucket: "schedule" as const, importance: 0.5, urgency: 0.5 };

describe("focusScore due handling", () => {
  // Monday 2026-10-12 at 21:30 local.
  const now = new Date(2026, 9, 12, 21, 30);

  it("treats a due date of today as today, not overdue", () => {
    const today = focusScore({ ...base, due: "2026-10-12", now });
    const yesterday = focusScore({ ...base, due: "2026-10-11", now });
    const tomorrow = focusScore({ ...base, due: "2026-10-13", now });
    expect(yesterday).toBeLessThan(today);
    expect(today).toBeLessThan(tomorrow);
    expect(today - yesterday).toBeGreaterThan(400);
    expect(tomorrow - today).toBe(1);
  });

  it("ranks an undated task after a dated one this week", () => {
    const dated = focusScore({ ...base, due: "2026-10-15", now });
    const undated = focusScore({ ...base, due: null, now });
    expect(dated).toBeLessThan(undated);
  });
});
