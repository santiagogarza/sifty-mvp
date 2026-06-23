import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS, canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { describe, expect, it } from "vitest";

const userTemplate: UserProfile = {
  id: "u1",
  email: "user@example.com",
  displayName: "User",
  isCreator: false,
  createdAt: new Date(0).toISOString(),
};

describe("deriveEntitlement", () => {
  it("creator → unlimited", () => {
    const ent = deriveEntitlement({
      profile: { ...userTemplate, isCreator: true },
    });
    expect(ent.tier).toBe("creator");
    expect(ent.aiRunsLimitDay).toBe(Number.POSITIVE_INFINITY);
    expect(canRunAi(ent)).toEqual({ ok: true });
  });

  it("trialing in-window → 50/day", () => {
    const ent = deriveEntitlement({
      profile: userTemplate,
      trialStartedAt: new Date().toISOString(),
    });
    expect(ent.tier).toBe("trialing");
    expect(ent.aiRunsLimitDay).toBe(50);
    expect(canRunAi(ent)).toEqual({ ok: true });
  });

  it("trialing expired → 0/day, AI denied", () => {
    const past = new Date();
    past.setDate(past.getDate() - (TRIAL_DAYS + 1));
    const ent = deriveEntitlement({
      profile: userTemplate,
      trialStartedAt: past.toISOString(),
    });
    expect(ent.tier).toBe("expired");
    expect(ent.aiRunsLimitDay).toBe(0);
    const allowed = canRunAi(ent);
    expect(allowed.ok).toBe(false);
    if (!allowed.ok) expect(allowed.reason).toMatch(/Trial has ended/i);
  });

  it("subscribed-active → 200/day", () => {
    const ent = deriveEntitlement({
      profile: userTemplate,
      subscriptionActive: true,
    });
    expect(ent.tier).toBe("active");
    expect(ent.aiRunsLimitDay).toBe(200);
    expect(canRunAi(ent)).toEqual({ ok: true });
  });

  it("at-cap user gets denied with cap message", () => {
    const ent = deriveEntitlement({
      profile: userTemplate,
      subscriptionActive: true,
      aiRunsToday: 200,
    });
    const allowed = canRunAi(ent);
    expect(allowed.ok).toBe(false);
    if (!allowed.ok) expect(allowed.reason).toMatch(/cap reached/i);
  });
});
