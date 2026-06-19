import type { Entitlement, UserProfile } from "@/lib/domain/types";

/**
 * Entitlements.
 *
 * Two rules drive everything:
 * 1. The creator account (email match) is permanently unlimited.
 * 2. Everyone else gets a 30-day trial, then must activate a subscription.
 *
 * AI usage is metered with a simple per-day count. Real implementations
 * should persist this in `ai_runs`; here we expose a pure function that
 * derives entitlement from the profile + today's count, which keeps the
 * downstream UI simple.
 */

export const TRIAL_DAYS = 30;

export interface EntitlementInputs {
  profile: UserProfile;
  trialStartedAt?: string | null;
  subscriptionActive?: boolean;
  aiRunsToday?: number;
}

export function deriveEntitlement(inputs: EntitlementInputs): Entitlement {
  if (inputs.profile.isCreator) {
    return {
      tier: "creator",
      trialEndsAt: null,
      aiRunsToday: inputs.aiRunsToday ?? 0,
      aiRunsLimitDay: Number.POSITIVE_INFINITY,
    };
  }
  if (inputs.subscriptionActive) {
    return {
      tier: "active",
      trialEndsAt: null,
      aiRunsToday: inputs.aiRunsToday ?? 0,
      aiRunsLimitDay: 200,
    };
  }
  const trialStart = inputs.trialStartedAt ? new Date(inputs.trialStartedAt) : new Date();
  const trialEnd = new Date(trialStart);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
  const now = new Date();
  const trialing = now < trialEnd;
  return {
    tier: trialing ? "trialing" : "expired",
    trialEndsAt: trialEnd.toISOString(),
    aiRunsToday: inputs.aiRunsToday ?? 0,
    aiRunsLimitDay: trialing ? 50 : 0,
  };
}

export function canRunAi(ent: Entitlement): { ok: true } | { ok: false; reason: string } {
  if (ent.tier === "creator") return { ok: true };
  if (ent.tier === "expired") return { ok: false, reason: "Trial has ended. Upgrade to continue." };
  if (ent.aiRunsToday >= ent.aiRunsLimitDay) {
    return { ok: false, reason: "Daily AI usage cap reached. Try again tomorrow." };
  }
  return { ok: true };
}
