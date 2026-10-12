import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import type { Entitlement, FeatureCaps, Tier, UserProfile } from "@/lib/domain/types";

/**
 * Entitlements.
 *
 * The persisted `EntitlementSnapshot` holds *facts* (creator flag on the
 * profile, Stripe subscription state, comp grant, trial window). This module
 * turns facts into an effective tier and the per-feature caps that gate the
 * product. Nothing downstream branches on tier names for gating; it reads
 * `caps`.
 *
 * Precedence when several facts apply: `creator > comped > pro > trialing > free`.
 * A comped user who also pays stays comped until the comp ends, then falls
 * to `pro`; a paying user whose trial window is still open is `pro`, etc.
 *
 * `pro` has two sources: Stripe is billing (`subscriptionActive`) or a
 * payment just failed and the dunning grace period (`graceEndsAt`) is still
 * open. Grace is time-based like trial and comp, so readers downgrade on
 * time even if the cron that persists the drop runs late.
 */

export const TRIAL_DAYS = 30;
/** Days of Pro kept after a failed payment before dropping to free. */
export const GRACE_PERIOD_DAYS = 7;

export const FREE_SIFTS_PER_DAY = 5;
/** Pro is "unlimited" in the product; this is the abuse ceiling, not a feature. */
export const PRO_FAIR_USE_SIFTS_PER_DAY = 200;
export const PRO_EXECUTION_BUDGET_CENTS_MONTH = 1_000;

const UNLIMITED = Number.POSITIVE_INFINITY;

const FREE_CAPS: FeatureCaps = {
  siftsPerDay: FREE_SIFTS_PER_DAY,
  executionBudgetCentsMonth: 0,
  connectorsAllowed: false,
};

const PRO_CAPS: FeatureCaps = {
  siftsPerDay: PRO_FAIR_USE_SIFTS_PER_DAY,
  executionBudgetCentsMonth: PRO_EXECUTION_BUDGET_CENTS_MONTH,
  connectorsAllowed: true,
};

const CREATOR_CAPS: FeatureCaps = {
  siftsPerDay: UNLIMITED,
  executionBudgetCentsMonth: UNLIMITED,
  connectorsAllowed: true,
};

export const CAPS_BY_TIER: Readonly<Record<Tier, FeatureCaps>> = {
  free: FREE_CAPS,
  trialing: PRO_CAPS,
  pro: PRO_CAPS,
  comped: PRO_CAPS,
  creator: CREATOR_CAPS,
};

export function capsForTier(tier: Tier): FeatureCaps {
  return { ...CAPS_BY_TIER[tier] };
}

/** The facts `resolveTier` needs; a subset of the snapshot plus the profile flag. */
export interface TierFacts {
  isCreator: boolean;
  subscriptionActive: boolean;
  compedAt: string | null;
  compedUntil: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
}

export function isCompActive(
  facts: Pick<TierFacts, "compedAt" | "compedUntil">,
  now: Date = new Date(),
): boolean {
  if (!facts.compedAt) return false;
  if (!facts.compedUntil) return true;
  return now.getTime() < Date.parse(facts.compedUntil);
}

export function isTrialActive(trialEndsAt: string | null, now: Date = new Date()): boolean {
  return !!trialEndsAt && now.getTime() < Date.parse(trialEndsAt);
}

export function isGraceActive(graceEndsAt: string | null, now: Date = new Date()): boolean {
  return !!graceEndsAt && now.getTime() < Date.parse(graceEndsAt);
}

export function resolveTier(facts: TierFacts, now: Date = new Date()): Tier {
  if (facts.isCreator) return "creator";
  if (isCompActive(facts, now)) return "comped";
  if (facts.subscriptionActive || isGraceActive(facts.graceEndsAt, now)) return "pro";
  if (isTrialActive(facts.trialEndsAt, now)) return "trialing";
  return "free";
}

/** Stripe statuses that mean a payment is owed and Pro is at risk. */
const DUNNING_STATUSES = new Set(["past_due", "unpaid"]);

export type PaymentProblem =
  /**
   * Payment failed; Pro is kept until `graceEndsAt` — the dunning window,
   * or the end of a still-open app trial when that outlives the window.
   */
  | { kind: "grace"; graceEndsAt: string }
  /** The grace period ran out (or Stripe gave up); Pro is off until payment recovers. */
  | { kind: "lapsed" };

/**
 * What the failed-payment banner should say, or null when billing is fine.
 * Comped and creator accounts are never nagged: their access does not
 * depend on the card, and the Stripe facts stay recorded for the portal.
 */
export function paymentProblem(
  snapshot: EntitlementSnapshot | null,
  isCreator: boolean,
  now: Date = new Date(),
): PaymentProblem | null {
  if (!snapshot || isCreator) return null;
  if (isCompActive(snapshot, now)) return null;
  if (snapshot.subscriptionActive) return null;
  if (isGraceActive(snapshot.graceEndsAt, now)) {
    return { kind: "grace", graceEndsAt: snapshot.graceEndsAt as string };
  }
  if (!snapshot.stripeStatus || !DUNNING_STATUSES.has(snapshot.stripeStatus)) return null;
  // Grace is over but an open app trial still resolves to Pro caps, so Pro
  // is not paused yet: name the trial end as the deadline instead.
  if (isTrialActive(snapshot.trialEndsAt, now)) {
    return { kind: "grace", graceEndsAt: snapshot.trialEndsAt as string };
  }
  return { kind: "lapsed" };
}

/** A snapshot with no facts at all: a `free` account that never had a trial. */
export function emptySnapshot(): EntitlementSnapshot {
  return {
    tier: "free",
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionActive: false,
    compedAt: null,
    compedUntil: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
  };
}

/** The snapshot a new non-creator sign-up gets: a Pro trial starting now. */
export function trialSnapshot(
  days: number = TRIAL_DAYS,
  now: Date = new Date(),
): EntitlementSnapshot {
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return {
    ...emptySnapshot(),
    tier: "trialing",
    trialStartedAt: now.toISOString(),
    trialEndsAt: end.toISOString(),
  };
}

export function creatorSnapshot(): EntitlementSnapshot {
  return { ...emptySnapshot(), tier: "creator" };
}

/**
 * Recompute the cached `tier` from the snapshot's facts. Every writer calls
 * this before `entitlements.upsert()` so the stored tier matches what
 * `deriveEntitlement` will report.
 */
export function withResolvedTier(
  snapshot: EntitlementSnapshot,
  isCreator: boolean,
  now: Date = new Date(),
): EntitlementSnapshot {
  return { ...snapshot, tier: resolveTier({ ...snapshot, isCreator }, now) };
}

export interface EntitlementInputs {
  profile: Pick<UserProfile, "isCreator">;
  snapshot: EntitlementSnapshot | null;
  siftsToday?: number;
  now?: Date;
}

export function deriveEntitlement(inputs: EntitlementInputs): Entitlement {
  const now = inputs.now ?? new Date();
  const snap = inputs.snapshot;
  const tier = resolveTier(
    {
      isCreator: inputs.profile.isCreator,
      subscriptionActive: snap?.subscriptionActive ?? false,
      compedAt: snap?.compedAt ?? null,
      compedUntil: snap?.compedUntil ?? null,
      trialEndsAt: snap?.trialEndsAt ?? null,
      graceEndsAt: snap?.graceEndsAt ?? null,
    },
    now,
  );
  return {
    tier,
    trialEndsAt: snap?.trialEndsAt ?? null,
    compedUntil: tier === "comped" ? (snap?.compedUntil ?? null) : null,
    siftsToday: inputs.siftsToday ?? 0,
    caps: capsForTier(tier),
  };
}

export type AiDenialCode = "free_cap" | "fair_use_cap";

export type AiAdmission = { ok: true } | { ok: false; code: AiDenialCode; reason: string };

/**
 * Daily sifting gate. Driven by `caps.siftsPerDay`, never by tier name; the
 * tier only picks the wording, because a free user at the cap has an upgrade
 * path and a Pro user at the fair-use ceiling does not.
 */
export function canRunAi(ent: Entitlement): AiAdmission {
  if (ent.siftsToday < ent.caps.siftsPerDay) return { ok: true };
  if (ent.tier === "free") {
    return {
      ok: false,
      code: "free_cap",
      reason: `${FREE_CAP_PREFIX} ${ent.caps.siftsPerDay} free sifts. Upgrade to Pro for unlimited sifting, or capture now and sift tomorrow.`,
    };
  }
  return { ok: false, code: "fair_use_cap", reason: FAIR_USE_CAP_MESSAGE };
}

const FREE_CAP_PREFIX = "You've used today's";
const FAIR_USE_CAP_MESSAGE = "You've hit today's fair-use limit for sifting. It resets tomorrow.";

/**
 * The client stores the 402 reason on `task.aiError` (a plain string); this
 * lets it recognize a cap denial without a second field on the task.
 */
export function isSiftCapMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.startsWith(FREE_CAP_PREFIX) || message === FAIR_USE_CAP_MESSAGE;
}

export function canUseConnectors(ent: Entitlement): boolean {
  return ent.caps.connectorsAllowed;
}

/** Short label for badges. */
export function tierLabel(tier: Tier): string {
  switch (tier) {
    case "creator":
      return "Creator";
    case "comped":
      return "Pro";
    case "pro":
      return "Pro";
    case "trialing":
      return "Pro trial";
    case "free":
      return "Free";
  }
}

/**
 * Calendar day for billing deadlines (trial end, comp end, grace end).
 * Pinned to UTC so the server render, the client hydration, and the email
 * (`formatEmailDate`, also UTC) all name the same day regardless of where
 * the server or the browser sits.
 */
export function formatBillingDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One-line description for account surfaces. */
export function tierSummary(
  ent: Pick<Entitlement, "tier" | "trialEndsAt" | "compedUntil">,
): string {
  const fmt = (iso: string) => formatBillingDay(iso);
  switch (ent.tier) {
    case "creator":
      return "Creator — unlimited";
    case "comped":
      return ent.compedUntil
        ? `Pro via invite code — until ${fmt(ent.compedUntil)}`
        : "Pro via invite code";
    case "pro":
      return "Sifty Pro — subscription active";
    case "trialing":
      return ent.trialEndsAt ? `Pro trial — ends ${fmt(ent.trialEndsAt)}` : "Pro trial";
    case "free":
      return `Free — ${FREE_SIFTS_PER_DAY} sifts a day`;
  }
}
