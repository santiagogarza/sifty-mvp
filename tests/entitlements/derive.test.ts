import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import type { UserProfile } from "@/lib/domain/types";
import {
  FREE_SIFTS_PER_DAY,
  PRO_FAIR_USE_SIFTS_PER_DAY,
  TRIAL_DAYS,
  canRunAi,
  canUseConnectors,
  creatorSnapshot,
  deriveEntitlement,
  emptySnapshot,
  isSiftCapMessage,
  resolveTier,
  trialSnapshot,
  withResolvedTier,
} from "@/lib/entitlements/entitlements";
import { describe, expect, it } from "vitest";

const user: UserProfile = {
  id: "u1",
  email: "user@example.com",
  displayName: "User",
  isCreator: false,
  createdAt: new Date(0).toISOString(),
};
const creator: UserProfile = { ...user, isCreator: true };

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function snap(overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return { ...emptySnapshot(), ...overrides };
}

describe("deriveEntitlement — tiers and caps", () => {
  it("creator → unlimited everything", () => {
    const ent = deriveEntitlement({ profile: creator, snapshot: creatorSnapshot() });
    expect(ent.tier).toBe("creator");
    expect(ent.caps.siftsPerDay).toBe(Number.POSITIVE_INFINITY);
    expect(ent.caps.executionBudgetCentsMonth).toBe(Number.POSITIVE_INFINITY);
    expect(canUseConnectors(ent)).toBe(true);
    expect(canRunAi({ ...ent, siftsToday: 10_000 })).toEqual({ ok: true });
  });

  it("no snapshot → free with the free caps", () => {
    const ent = deriveEntitlement({ profile: user, snapshot: null });
    expect(ent.tier).toBe("free");
    expect(ent.caps).toEqual({
      siftsPerDay: FREE_SIFTS_PER_DAY,
      executionBudgetCentsMonth: 0,
      connectorsAllowed: false,
    });
  });

  it("fresh sign-up → trialing with Pro caps", () => {
    const ent = deriveEntitlement({ profile: user, snapshot: trialSnapshot() });
    expect(ent.tier).toBe("trialing");
    expect(ent.caps.siftsPerDay).toBe(PRO_FAIR_USE_SIFTS_PER_DAY);
    expect(ent.caps.connectorsAllowed).toBe(true);
    expect(ent.trialEndsAt).toBeTruthy();
  });

  it("trial window ended → free, not a dead account", () => {
    const started = new Date(Date.now() - (TRIAL_DAYS + 1) * DAY);
    const ent = deriveEntitlement({ profile: user, snapshot: trialSnapshot(TRIAL_DAYS, started) });
    expect(ent.tier).toBe("free");
    expect(ent.caps.siftsPerDay).toBe(FREE_SIFTS_PER_DAY);
    expect(canRunAi(ent)).toEqual({ ok: true });
  });

  it("paying subscription → pro", () => {
    const ent = deriveEntitlement({ profile: user, snapshot: snap({ subscriptionActive: true }) });
    expect(ent.tier).toBe("pro");
    expect(ent.caps.siftsPerDay).toBe(PRO_FAIR_USE_SIFTS_PER_DAY);
  });

  it("comped forever → comped with Pro caps and no end date", () => {
    const ent = deriveEntitlement({
      profile: user,
      snapshot: snap({ compedAt: iso(-DAY), compedUntil: null }),
    });
    expect(ent.tier).toBe("comped");
    expect(ent.compedUntil).toBeNull();
    expect(ent.caps.siftsPerDay).toBe(PRO_FAIR_USE_SIFTS_PER_DAY);
  });

  it("comped with an end date → comped until then, then falls through", () => {
    const active = deriveEntitlement({
      profile: user,
      snapshot: snap({ compedAt: iso(-DAY), compedUntil: iso(DAY) }),
    });
    expect(active.tier).toBe("comped");
    expect(active.compedUntil).toBeTruthy();

    const lapsed = deriveEntitlement({
      profile: user,
      snapshot: snap({ compedAt: iso(-2 * DAY), compedUntil: iso(-DAY) }),
    });
    expect(lapsed.tier).toBe("free");
    expect(lapsed.compedUntil).toBeNull();
  });
});

describe("resolveTier — precedence creator > comped > pro > trialing > free", () => {
  const everything = {
    isCreator: true,
    subscriptionActive: true,
    compedAt: iso(-DAY),
    compedUntil: null,
    trialEndsAt: iso(DAY),
    graceEndsAt: null,
  };

  it("creator wins over all other facts", () => {
    expect(resolveTier(everything)).toBe("creator");
  });

  it("comped wins over a paying subscription and an open trial", () => {
    expect(resolveTier({ ...everything, isCreator: false })).toBe("comped");
  });

  it("pro wins over an open trial", () => {
    expect(resolveTier({ ...everything, isCreator: false, compedAt: null })).toBe("pro");
  });

  it("trialing wins over free while the window is open", () => {
    expect(
      resolveTier({ ...everything, isCreator: false, compedAt: null, subscriptionActive: false }),
    ).toBe("trialing");
  });

  it("an open grace period keeps pro after Stripe stopped billing", () => {
    const facts = { ...everything, isCreator: false, compedAt: null, subscriptionActive: false };
    expect(resolveTier({ ...facts, graceEndsAt: iso(DAY) })).toBe("pro");
    expect(resolveTier({ ...facts, graceEndsAt: iso(-DAY) })).toBe("trialing");
    expect(resolveTier({ ...facts, trialEndsAt: null, graceEndsAt: iso(-DAY) })).toBe("free");
  });

  it("an expired comp does not shadow a paying subscription", () => {
    expect(
      resolveTier({
        isCreator: false,
        subscriptionActive: true,
        compedAt: iso(-2 * DAY),
        compedUntil: iso(-DAY),
        trialEndsAt: null,
        graceEndsAt: null,
      }),
    ).toBe("pro");
  });

  it("withResolvedTier caches the effective tier on the snapshot", () => {
    const s = withResolvedTier(snap({ subscriptionActive: true, tier: "free" }), false);
    expect(s.tier).toBe("pro");
    expect(withResolvedTier(snap(), true).tier).toBe("creator");
  });
});

describe("canRunAi — driven by caps, worded by tier", () => {
  it("free user at the cap → free_cap with an upgrade path", () => {
    const ent = deriveEntitlement({
      profile: user,
      snapshot: null,
      siftsToday: FREE_SIFTS_PER_DAY,
    });
    const allowed = canRunAi(ent);
    expect(allowed.ok).toBe(false);
    if (allowed.ok) return;
    expect(allowed.code).toBe("free_cap");
    expect(allowed.reason).toMatch(/upgrade to pro/i);
    expect(isSiftCapMessage(allowed.reason)).toBe(true);
  });

  it("free user under the cap → ok", () => {
    const ent = deriveEntitlement({
      profile: user,
      snapshot: null,
      siftsToday: FREE_SIFTS_PER_DAY - 1,
    });
    expect(canRunAi(ent)).toEqual({ ok: true });
  });

  it("pro user at the fair-use ceiling → fair_use_cap, no upgrade pitch", () => {
    const ent = deriveEntitlement({
      profile: user,
      snapshot: snap({ subscriptionActive: true }),
      siftsToday: PRO_FAIR_USE_SIFTS_PER_DAY,
    });
    const allowed = canRunAi(ent);
    expect(allowed.ok).toBe(false);
    if (allowed.ok) return;
    expect(allowed.code).toBe("fair_use_cap");
    expect(allowed.reason).not.toMatch(/upgrade/i);
    expect(isSiftCapMessage(allowed.reason)).toBe(true);
  });

  it("comped and trialing users share the Pro ceiling", () => {
    for (const s of [snap({ compedAt: iso(-DAY) }), trialSnapshot()]) {
      const under = deriveEntitlement({
        profile: user,
        snapshot: s,
        siftsToday: FREE_SIFTS_PER_DAY + 1,
      });
      expect(canRunAi(under)).toEqual({ ok: true });
      const at = deriveEntitlement({
        profile: user,
        snapshot: s,
        siftsToday: PRO_FAIR_USE_SIFTS_PER_DAY,
      });
      expect(canRunAi(at).ok).toBe(false);
    }
  });

  it("isSiftCapMessage ignores unrelated errors", () => {
    expect(isSiftCapMessage("Triage failed (500)")).toBe(false);
    expect(isSiftCapMessage(null)).toBe(false);
  });
});
