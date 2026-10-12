import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
  effectiveSendHour,
  inQuietHours,
  isValidTimeZone,
  resolvePreferences,
} from "@/lib/notifications/preferences";
import { describe, expect, it } from "vitest";

describe("notification preferences", () => {
  it("resolves a missing row to the defaults, unsaved, with the caller's zone when valid", () => {
    const resolved = resolvePreferences(null, { fallbackTimeZone: "Europe/Ljubljana" });
    expect(resolved).toMatchObject({ ...DEFAULT_PREFERENCES, timezone: "Europe/Ljubljana" });
    expect(resolved.saved).toBe(false);
    expect(resolved.updatedAt).toBeNull();

    expect(resolvePreferences(null, { fallbackTimeZone: "Mars/Olympus" }).timezone).toBe("UTC");
    expect(resolvePreferences(null).timezone).toBe("UTC");
  });

  it("resolves a saved row verbatim and marks it saved", () => {
    const resolved = resolvePreferences({
      ...DEFAULT_PREFERENCES,
      userId: "u1",
      timezone: "America/New_York",
      morningPlanHour: 6,
      updatedAt: "2026-10-12T08:00:00.000Z",
    });
    expect(resolved.saved).toBe(true);
    expect(resolved.timezone).toBe("America/New_York");
    expect(resolved.morningPlanHour).toBe(6);
    expect("userId" in resolved).toBe(false);
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/Ljubljana")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("schema: rejects out-of-range hours, half quiet hours, and unknown zones", () => {
    const ok = PreferencesSchema.safeParse(DEFAULT_PREFERENCES);
    expect(ok.success).toBe(true);

    expect(
      PreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, morningPlanHour: 24 }).success,
    ).toBe(false);
    expect(
      PreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, weeklyReviewDay: 7 }).success,
    ).toBe(false);
    expect(
      PreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, timezone: "Nowhere/Land" }).success,
    ).toBe(false);
    const half = PreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, quietHoursStart: 22 });
    expect(half.success).toBe(false);
    const same = PreferencesSchema.safeParse({
      ...DEFAULT_PREFERENCES,
      quietHoursStart: 9,
      quietHoursEnd: 9,
    });
    expect(same.success).toBe(false);
    expect(
      PreferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, quietHoursStart: 22, quietHoursEnd: 7 })
        .success,
    ).toBe(true);
  });

  it("quiet hours: half-open, wrapping midnight when start > end", () => {
    const night = { quietHoursStart: 22, quietHoursEnd: 7 };
    expect(inQuietHours(night, 22)).toBe(true);
    expect(inQuietHours(night, 23)).toBe(true);
    expect(inQuietHours(night, 0)).toBe(true);
    expect(inQuietHours(night, 6)).toBe(true);
    expect(inQuietHours(night, 7)).toBe(false);
    expect(inQuietHours(night, 12)).toBe(false);
    expect(inQuietHours(night, 21)).toBe(false);

    const siesta = { quietHoursStart: 13, quietHoursEnd: 15 };
    expect(inQuietHours(siesta, 13)).toBe(true);
    expect(inQuietHours(siesta, 14)).toBe(true);
    expect(inQuietHours(siesta, 15)).toBe(false);
    expect(inQuietHours(siesta, 12)).toBe(false);

    expect(inQuietHours({ quietHoursStart: null, quietHoursEnd: null }, 3)).toBe(false);
  });

  it("quiet hours defer a send to the end of the window instead of dropping it", () => {
    const night = { quietHoursStart: 22, quietHoursEnd: 8 };
    expect(effectiveSendHour(night, 7)).toBe(8);
    expect(effectiveSendHour(night, 23)).toBe(8);
    expect(effectiveSendHour(night, 9)).toBe(9);
    expect(effectiveSendHour({ quietHoursStart: null, quietHoursEnd: null }, 7)).toBe(7);
  });
});
