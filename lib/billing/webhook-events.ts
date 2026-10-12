/**
 * Events the webhook endpoint acts on. Register exactly these on the Stripe
 * endpoint (Developers → Webhooks); anything else is acknowledged and
 * ignored.
 */

/** Events the pure reducer (`applyStripeEvent`) understands. */
export const REDUCED_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/** Events handled outside the reducer (customer linkage only). */
export const LINK_EVENTS = ["checkout.session.completed"] as const;

export const WEBHOOK_EVENTS = [...REDUCED_EVENTS, ...LINK_EVENTS] as const;

export const HANDLED_EVENTS: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);
