import { FREE_SIFTS_PER_DAY, TRIAL_DAYS } from "@/lib/entitlements/entitlements";

/**
 * Plan catalog — the one place prices and plan features live. Their copy
 * lives in the `marketing` message catalog.
 *
 * The pricing page renders from this module and the billing layer should
 * read `PRO_PRICES` when creating Stripe prices so the two never drift.
 * Amounts are placeholders until Stripe is wired (decision D3: $8–12/mo,
 * roughly two months free yearly).
 */

export type PlanId = "free" | "pro";
export type Cadence = "monthly" | "yearly";

export interface Price {
  cadence: Cadence;
  amountCents: number;
  currency: "usd";
}

export const PRO_PRICES: Record<Cadence, Price> = {
  monthly: { cadence: "monthly", amountCents: 1_000, currency: "usd" },
  yearly: { cadence: "yearly", amountCents: 9_600, currency: "usd" },
};

export { FREE_SIFTS_PER_DAY };
export const PRO_TRIAL_DAYS = TRIAL_DAYS;

export type FeatureStatus = "live" | "rolling-out";

/**
 * Feature ids key the copy in `messages/<locale>/marketing.json`
 * (`plans.<plan>.features.<id>`); the catalog test keeps the two in step.
 */
export interface PlanFeature<Id extends string = string> {
  id: Id;
  status: FeatureStatus;
}

export const PLANS = {
  free: {
    id: "free",
    features: [
      { id: "unlimitedTasks", status: "live" },
      { id: "capture", status: "live" },
      { id: "sync", status: "live" },
      { id: "dailySifts", status: "live" },
      { id: "reminders", status: "rolling-out" },
    ],
  },
  pro: {
    id: "pro",
    features: [
      { id: "unlimitedSifting", status: "live" },
      { id: "betterModels", status: "live" },
      { id: "executionBudget", status: "rolling-out" },
      { id: "connectors", status: "rolling-out" },
    ],
  },
} as const satisfies Record<PlanId, { id: PlanId; features: readonly PlanFeature[] }>;

export function formatPrice(price: Price): string {
  const dollars = price.amountCents / 100;
  const formatted = Number.isInteger(dollars) ? `${dollars}` : dollars.toFixed(2);
  return `$${formatted}`;
}

/** Whole-percent saving of paying yearly versus twelve monthly payments. */
export function yearlySavingsPercent(): number {
  const monthlyTotal = PRO_PRICES.monthly.amountCents * 12;
  const saved = monthlyTotal - PRO_PRICES.yearly.amountCents;
  return Math.round((saved / monthlyTotal) * 100);
}
