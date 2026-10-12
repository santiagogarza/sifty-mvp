import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import { withResolvedTier } from "@/lib/entitlements/entitlements";

/**
 * Stripe event reducer.
 *
 * Pure: takes the user's current entitlement and a Stripe event, returns
 * the next entitlement. Tested exhaustively in `tests/billing/events.test.ts`.
 *
 * Three invariants:
 *
 * 1. Creator never downgrades. Their entitlement is sticky — even if Stripe
 *    fires a `subscription.deleted` for some reason (we never bill them in
 *    practice, but defense in depth).
 * 2. The reducer only writes the *Stripe facts* (`subscriptionActive`,
 *    `stripeStatus`, ids, period end). The effective tier is re-resolved
 *    from all facts with the precedence `creator > comped > pro > trialing >
 *    free`, so a Stripe cancellation never strips an invite-code comp and a
 *    comp never hides a paying subscription from the Stripe fields.
 * 3. The reducer is deterministic for an `(entitlement, event)` pair. Repeat
 *    invocations produce the same output. Idempotency at the persistence
 *    layer (the `stripeEvents` table) prevents duplicated *side effects*;
 *    this reducer protects against state divergence in the case where the
 *    idempotency check fails open.
 */

export interface StripeSubscriptionLike {
  id: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end?: boolean;
  customer?: string | { id: string };
  items?: { data: Array<{ price?: { id: string } }> };
}

export interface StripeInvoiceLike {
  id?: string;
  customer?: string | { id: string };
  subscription?: string | StripeSubscriptionLike | null;
  status?: string;
}

export type ReducibleEvent =
  | { type: "customer.subscription.created"; data: { object: StripeSubscriptionLike } }
  | { type: "customer.subscription.updated"; data: { object: StripeSubscriptionLike } }
  | { type: "customer.subscription.deleted"; data: { object: StripeSubscriptionLike } }
  | { type: "invoice.paid"; data: { object: StripeInvoiceLike } }
  | { type: "invoice.payment_failed"; data: { object: StripeInvoiceLike } };

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export function applyStripeEvent(
  current: EntitlementSnapshot,
  event: ReducibleEvent,
): EntitlementSnapshot {
  if (current.tier === "creator") {
    // Creator entitlement is sticky. Record audit info on the side; the
    // tier itself never changes.
    return current;
  }

  const resolve = (facts: Partial<EntitlementSnapshot>): EntitlementSnapshot =>
    withResolvedTier({ ...current, ...facts }, false);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      // past_due / unpaid / incomplete / canceled / incomplete_expired all
      // mean "not paying right now"; grace periods are a later extension.
      return resolve({
        subscriptionActive: ACTIVE_STATUSES.has(sub.status),
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status,
        currentPeriodEnd: periodEnd,
        // Trial dates stay so we can show "started Pro on..." later.
      });
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return resolve({
        subscriptionActive: false,
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status ?? "canceled",
        currentPeriodEnd: null,
      });
    }
    case "invoice.paid": {
      // Subscription events drive state; a paid invoice adds nothing new.
      return current;
    }
    case "invoice.payment_failed": {
      return resolve({
        subscriptionActive: false,
        stripeStatus: "past_due",
      });
    }
    default: {
      // TS exhaustiveness check; explicit "no-op" for unknown events.
      return current;
    }
  }
}
