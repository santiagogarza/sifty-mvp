import type { EntitlementSnapshot } from "@/lib/db/repos/types";

/**
 * Stripe event reducer.
 *
 * Pure: takes the user's current entitlement and a Stripe event, returns
 * the next entitlement. Tested exhaustively in `tests/billing/events.test.ts`.
 *
 * Two invariants:
 *
 * 1. Creator never downgrades. Their entitlement is sticky — even if Stripe
 *    fires a `subscription.deleted` for some reason (we never bill them in
 *    practice, but defense in depth).
 * 2. The reducer is deterministic for an `(entitlement, event)` pair. Repeat
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
const PAST_DUE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

export function applyStripeEvent(
  current: EntitlementSnapshot,
  event: ReducibleEvent,
): EntitlementSnapshot {
  if (current.tier === "creator") {
    // Creator entitlement is sticky. Record audit info on the side; the
    // tier itself never changes.
    return current;
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const isActive = ACTIVE_STATUSES.has(sub.status);
      const isPastDue = PAST_DUE_STATUSES.has(sub.status);
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      if (isActive) {
        return {
          ...current,
          tier: "active",
          subscriptionActive: true,
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status,
          currentPeriodEnd: periodEnd,
          aiRunsLimitDay: 200,
          // Trial dates stay so we can show "started Pro on..." later.
        };
      }
      if (isPastDue) {
        return {
          ...current,
          tier: "expired",
          subscriptionActive: false,
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status,
          currentPeriodEnd: periodEnd,
          aiRunsLimitDay: 0,
        };
      }
      // canceled, incomplete_expired, etc.
      return {
        ...current,
        tier: "expired",
        subscriptionActive: false,
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status,
        currentPeriodEnd: periodEnd,
        aiRunsLimitDay: 0,
      };
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return {
        ...current,
        tier: "expired",
        subscriptionActive: false,
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status ?? "canceled",
        currentPeriodEnd: null,
        aiRunsLimitDay: 0,
      };
    }
    case "invoice.paid": {
      // Defensive: nudge active state in case we missed the subscription event.
      if (current.subscriptionActive) return current;
      return current;
    }
    case "invoice.payment_failed": {
      return {
        ...current,
        tier: "expired",
        subscriptionActive: false,
        stripeStatus: "past_due",
        aiRunsLimitDay: 0,
      };
    }
    default: {
      // TS exhaustiveness check; explicit "no-op" for unknown events.
      return current;
    }
  }
}
