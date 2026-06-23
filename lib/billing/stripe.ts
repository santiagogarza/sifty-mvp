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

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeNotConfiguredError("STRIPE_WEBHOOK_SECRET");
  return secret;
}

export function getPriceIds(): { monthly: string | null; yearly: string | null } {
  return {
    monthly: process.env.STRIPE_PRICE_MONTHLY ?? null,
    yearly: process.env.STRIPE_PRICE_YEARLY ?? null,
  };
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
