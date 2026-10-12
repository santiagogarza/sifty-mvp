import { type Cadence, PRO_PRICES, formatPrice } from "@/lib/billing/plans";
import Stripe from "stripe";

/**
 * Stripe SDK singleton.
 *
 * Built lazily so the bundle / cold-start cost is paid only when a billing
 * route is hit. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are required
 * for any Stripe-touching path; we throw clear errors when missing.
 */

let _stripe: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`${missing} is not configured. Add it to your environment.`);
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError("STRIPE_SECRET_KEY");
  _stripe = new Stripe(key, {
    appInfo: { name: "sifty", url: "https://sifty.app" },
  });
  return _stripe;
}

/** Tests swap the SDK for a fake; `null` restores the env-driven client. */
export function setStripeForTesting(stripe: Stripe | null): void {
  _stripe = stripe;
  verifiedPrices.clear();
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError("STRIPE_WEBHOOK_SECRET");
  return secret;
}

export function getPriceIds(): Record<Cadence, string | null> {
  return {
    monthly: process.env.STRIPE_PRICE_MONTHLY || null,
    yearly: process.env.STRIPE_PRICE_YEARLY || null,
  };
}

/**
 * Is the customer-facing side of billing usable? Checkout needs the secret
 * key and both price ids; the webhook secret only matters for inbound
 * events and is reported separately so a half-configured deploy says
 * exactly which half is missing.
 */
export interface BillingStatus {
  /** Checkout and the portal can run. */
  configured: boolean;
  /** Env vars still unset, in the order to fix them. */
  missing: string[];
  webhookConfigured: boolean;
}

export function getBillingStatus(): BillingStatus {
  const prices = getPriceIds();
  const missing: string[] = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!prices.monthly) missing.push("STRIPE_PRICE_MONTHLY");
  if (!prices.yearly) missing.push("STRIPE_PRICE_YEARLY");
  return {
    configured: missing.length === 0,
    missing,
    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
  };
}

export class StripePriceMismatchError extends Error {
  constructor(cadence: Cadence, priceId: string, detail: string) {
    super(
      `Stripe price ${priceId} (${cadence}) does not match lib/billing/plans.ts: ${detail}. ` +
        `Fix the price in the Stripe dashboard or STRIPE_PRICE_${cadence.toUpperCase()}.`,
    );
    this.name = "StripePriceMismatchError";
  }
}

const verifiedPrices = new Set<string>();

/**
 * The pricing page renders from `PRO_PRICES`; Checkout charges whatever the
 * Stripe price says. This check keeps the two from drifting apart silently:
 * amount, currency, and interval must agree before the first session is
 * created. Verified once per price id per process.
 */
export async function verifyPriceMatchesPlan(cadence: Cadence, priceId: string): Promise<void> {
  if (verifiedPrices.has(priceId)) return;
  const plan = PRO_PRICES[cadence];
  const price = await getStripe().prices.retrieve(priceId);
  const problems: string[] = [];
  if (!price.active) problems.push("price is archived");
  if (price.unit_amount !== plan.amountCents) {
    problems.push(
      `amount is ${price.unit_amount ?? "null"} cents, plan says ${plan.amountCents} (${formatPrice(plan)})`,
    );
  }
  if (price.currency !== plan.currency) {
    problems.push(`currency is ${price.currency}, plan says ${plan.currency}`);
  }
  const interval = cadence === "monthly" ? "month" : "year";
  if (price.recurring?.interval !== interval || (price.recurring?.interval_count ?? 1) !== 1) {
    problems.push(
      `interval is ${price.recurring ? `${price.recurring.interval_count} ${price.recurring.interval}` : "one-time"}, plan says 1 ${interval}`,
    );
  }
  // Checkout runs with automatic_tax, which Stripe rejects for unspecified prices.
  if (price.tax_behavior !== "inclusive" && price.tax_behavior !== "exclusive") {
    problems.push(
      `tax_behavior is ${price.tax_behavior ?? "null"}, Stripe Tax needs inclusive or exclusive`,
    );
  }
  if (problems.length) throw new StripePriceMismatchError(cadence, priceId, problems.join("; "));
  verifiedPrices.add(priceId);
}

/**
 * Verifies a webhook payload using HMAC. Returns the parsed event or throws.
 * Wraps Stripe's verifier so the test-only path can use the same surface.
 */
export function verifyAndParseEvent(rawBody: string, signature: string): Stripe.Event {
  const stripe = getStripe();
  const secret = getWebhookSecret();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
