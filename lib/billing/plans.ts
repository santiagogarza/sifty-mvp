import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";

/**
 * Plan catalog — the one place prices and tier copy live.
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

export const FREE_SIFTS_PER_DAY = 5;
export const PRO_TRIAL_DAYS = TRIAL_DAYS;

export type FeatureStatus = "live" | "rolling-out";

export interface PlanFeature {
  label: string;
  status: FeatureStatus;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  features: PlanFeature[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Capture everything. Sift a little every day.",
    features: [
      { label: "Unlimited tasks, labels, and memories", status: "live" },
      { label: "Capture from anywhere with one keystroke", status: "live" },
      { label: "Sync across devices, offline edits replay", status: "live" },
      { label: `${FREE_SIFTS_PER_DAY} sifts a day`, status: "live" },
      { label: "Reminders", status: "rolling-out" },
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Everything in Free, plus Sifty does the work.",
    features: [
      { label: "Unlimited sifting", status: "live" },
      { label: "Higher-quality models", status: "live" },
      { label: "Monthly budget for autonomous execution", status: "rolling-out" },
      { label: "Connectors to email, calendar, and tools", status: "rolling-out" },
    ],
  },
};

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
