import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import { GRACE_PERIOD_DAYS, withResolvedTier } from "@/lib/entitlements/entitlements";

/**
 * Stripe event reducer.
 *
 * Pure: takes the user's current entitlement, a Stripe event, and the clock,
 * returns the next entitlement. Tested exhaustively in
 * `tests/billing/events.test.ts`.
 *
 * Invariants:
 *
 * 1. Creator never downgrades. Their entitlement is sticky — even if Stripe
 *    fires a `subscription.deleted` for some reason (we never bill them in
 *    practice, but defense in depth).
 * 2. The reducer only writes the *Stripe facts* (`subscriptionActive`,
 *    `stripeStatus`, ids, period end, `graceEndsAt`). The effective tier is
 *    re-resolved from all facts with the precedence `creator > comped > pro
 *    > trialing > free`, so a Stripe cancellation never strips an invite-code
 *    comp and a comp never hides a paying subscription from the Stripe fields.
 * 3. The reducer is deterministic for an `(entitlement, event, now)` triple.
 *    Time comes from `event.created` when Stripe supplies it, else from the
 *    `now` argument, never from the wall clock. Idempotency at the
 *    persistence layer (the `stripeEvents` table) prevents duplicated *side
 *    effects*; this reducer protects against state divergence in the case
 *    where the idempotency check fails open.
 * 4. Grace is sticky within one dunning cycle. The first failure opens a
 *    `GRACE_PERIOD_DAYS` window; later failures in the same cycle do not
 *    extend it. Recovery (`active`/`trialing`, `invoice.paid`) and
 *    cancellation (`deleted`, `canceled`, `incomplete_expired`) close it.
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
  amount_due?: number;
  currency?: string;
}

interface EventMeta {
  /** Unix seconds; Stripe sets it on every event. */
  created?: number;
}

export type ReducibleEvent = EventMeta &
  (
    | { type: "customer.subscription.created"; data: { object: StripeSubscriptionLike } }
    | { type: "customer.subscription.updated"; data: { object: StripeSubscriptionLike } }
    | { type: "customer.subscription.deleted"; data: { object: StripeSubscriptionLike } }
    | { type: "invoice.paid"; data: { object: StripeInvoiceLike } }
    | { type: "invoice.payment_failed"; data: { object: StripeInvoiceLike } }
  );

/** Stripe is collecting money (or running its own trial on a card it holds). */
const PAYING_STATUSES = new Set(["active", "trialing"]);
/** A payment is owed; Stripe keeps retrying. We keep Pro for the grace window. */
const DUNNING_STATUSES = new Set(["past_due", "unpaid"]);
/** The subscription is gone or never started; no money is coming. */
const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);
/**
 * A subscription Stripe still considers open. A second Checkout for such a
 * customer would create a second subscription, so checkout refuses with 409
 * and points at the portal instead.
 */
const OPEN_STATUSES = new Set([...PAYING_STATUSES, ...DUNNING_STATUSES, "incomplete", "paused"]);

export function hasOpenStripeSubscription(snapshot: EntitlementSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.subscriptionActive) return true;
  return !!snapshot.stripeSubscriptionId && OPEN_STATUSES.has(snapshot.stripeStatus ?? "");
}

export function graceEndFrom(now: Date): string {
  return new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function applyStripeEvent(
  current: EntitlementSnapshot,
  event: ReducibleEvent,
  now: Date = new Date(),
): EntitlementSnapshot {
  if (current.tier === "creator") {
    // Creator entitlement is sticky. Record audit info on the side; the
    // tier itself never changes.
    return current;
  }

  const at = event.created ? new Date(event.created * 1000) : now;
  const resolve = (facts: Partial<EntitlementSnapshot>): EntitlementSnapshot =>
    withResolvedTier({ ...current, ...facts }, false, at);
  // Open a grace window on the first failure of a cycle; keep it afterwards.
  const keepOrOpenGrace = () => current.graceEndsAt ?? graceEndFrom(at);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
      const ids = {
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status,
        currentPeriodEnd: periodEnd,
      };
      if (PAYING_STATUSES.has(sub.status)) {
        return resolve({ ...ids, subscriptionActive: true, graceEndsAt: null });
      }
      if (DUNNING_STATUSES.has(sub.status)) {
        return resolve({ ...ids, subscriptionActive: false, graceEndsAt: keepOrOpenGrace() });
      }
      // incomplete (first payment never succeeded), paused (Stripe trial ended
      // without a card), canceled, incomplete_expired: nothing is owed, no grace.
      return resolve({ ...ids, subscriptionActive: false, graceEndsAt: null });
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      return resolve({
        subscriptionActive: false,
        stripeSubscriptionId: sub.id,
        stripeStatus: ENDED_STATUSES.has(sub.status) ? sub.status : "canceled",
        currentPeriodEnd: null,
        graceEndsAt: null,
      });
    }
    case "invoice.paid": {
      // Subscription events drive state; a paid invoice only matters when it
      // recovers a dunning cycle, which may arrive before the matching
      // `subscription.updated` (status active).
      if (!current.graceEndsAt && !DUNNING_STATUSES.has(current.stripeStatus ?? "")) {
        return current;
      }
      return resolve({ subscriptionActive: true, stripeStatus: "active", graceEndsAt: null });
    }
    case "invoice.payment_failed": {
      return resolve({
        subscriptionActive: false,
        stripeStatus: "past_due",
        graceEndsAt: keepOrOpenGrace(),
      });
    }
    default: {
      // TS exhaustiveness check; explicit "no-op" for unknown events.
      return current;
    }
  }
}
