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
 *    `now` argument, never from the wall clock. `stripeSyncedAt` records the
 *    newest applied `event.created` for the tracked subscription; older
 *    events for it are ignored because Stripe does not guarantee order. Idempotency at the
 *    persistence layer (the `stripeEvents` table) prevents duplicated *side
 *    effects*; this reducer protects against state divergence in the case
 *    where the idempotency check fails open.
 * 4. One grace window per dunning cycle. The first failure opens a
 *    `GRACE_PERIOD_DAYS` window; later failures in the same cycle neither
 *    extend nor reopen it, even after `expireGracePeriods()` has cleared
 *    the timestamp (the `past_due`/`unpaid` status marks the cycle as under
 *    way). Recovery (`active`/`trialing`, `invoice.paid`) ends the cycle;
 *    cancellation (`deleted`, `canceled`, `incomplete_expired`), `paused`,
 *    and `incomplete` end it too and make later `invoice.payment_failed`
 *    retries no-ops, so a stray retry can never revive Pro.
 */

export interface StripeSubscriptionLike {
  id: string;
  status: string;
  /** Period end on API versions before 2025-03-31; basil and later carry it per item. */
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  customer?: string | { id: string };
  items?: { data: Array<{ price?: { id: string }; current_period_end?: number | null }> };
}

/** ISO period end from whichever API-version shape delivered the subscription. */
export function subscriptionPeriodEnd(sub: StripeSubscriptionLike): string | null {
  const candidates = [
    sub.current_period_end,
    ...(sub.items?.data ?? []).map((item) => item.current_period_end),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates) * 1000).toISOString();
}

export interface StripeInvoiceLike {
  id?: string;
  customer?: string | { id: string };
  /** Subscription link on webhook endpoints pinned to API versions before 2025-03-31. */
  subscription?: string | StripeSubscriptionLike | null;
  /** Subscription link on current API versions (basil and later). */
  parent?: {
    subscription_details?: { subscription?: string | StripeSubscriptionLike | null } | null;
  } | null;
  status?: string;
  amount_due?: number;
  currency?: string;
}

/** The subscription an invoice bills, whichever API-version shape delivered it. */
export function invoiceSubscriptionId(invoice: StripeInvoiceLike): string | null {
  const raw = invoice.parent?.subscription_details?.subscription ?? invoice.subscription ?? null;
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id;
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
/** Statuses where a failed invoice must not start (or restart) dunning. */
const NO_DUNNING_STATUSES = new Set([...ENDED_STATUSES, "incomplete", "paused"]);
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
  const eventAt = event.created ? at.toISOString() : null;
  const resolve = (facts: Partial<EntitlementSnapshot>): EntitlementSnapshot =>
    withResolvedTier(
      { ...current, ...facts, stripeSyncedAt: eventAt ?? current.stripeSyncedAt },
      false,
      at,
    );
  /**
   * Stripe does not guarantee delivery order. An event for the tracked
   * subscription that is older than the newest one already applied would
   * rewind state (a late `active` clearing a newer dunning window), so it is
   * ignored. Equal timestamps are applied: sibling events share a second.
   */
  const isOutdated = (subId: string | null): boolean =>
    !!eventAt &&
    !!current.stripeSyncedAt &&
    subId === current.stripeSubscriptionId &&
    Date.parse(eventAt) < Date.parse(current.stripeSyncedAt);
  /**
   * Invoice events only count for the subscription we track. A retry on an
   * old subscription's invoice after the user re-subscribed, or an invoice
   * that is not for a subscription at all, must not touch the entitlement.
   * With no subscription recorded yet (events out of order) the invoice's
   * subscription is adopted.
   */
  const invoiceSubscription = (invoice: StripeInvoiceLike): string | null => {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return null;
    if (current.stripeSubscriptionId && current.stripeSubscriptionId !== subId) return null;
    return subId;
  };
  // One grace window per dunning cycle. Keep an open one; once the cycle is
  // under way (status already past_due/unpaid, which outlives the window
  // after `expireGracePeriods()` clears it) later retries get no new window.
  // Only a transition from a non-dunning status opens one.
  const keepOrOpenGrace = (): string | null => {
    if (current.graceEndsAt) return current.graceEndsAt;
    if (DUNNING_STATUSES.has(current.stripeStatus ?? "")) return null;
    return graceEndFrom(at);
  };

  /**
   * Subscription events are only authoritative for the subscription we
   * track, with two exceptions: nothing tracked yet, or a paying
   * subscription superseding whatever we had. Stripe does not guarantee
   * ordering, so after a cancel-and-resubscribe the old subscription's
   * late `deleted` / `past_due` must not overwrite the new one, and a late
   * update for a subscription already in a terminal state is not a
   * resurrection.
   */
  const isStaleSubscriptionEvent = (sub: StripeSubscriptionLike): boolean => {
    const tracked = current.stripeSubscriptionId;
    if (!tracked) return false;
    if (sub.id === tracked) {
      if (isOutdated(sub.id)) return true;
      return ENDED_STATUSES.has(current.stripeStatus ?? "") && !ENDED_STATUSES.has(sub.status);
    }
    return hasOpenStripeSubscription(current) && !PAYING_STATUSES.has(sub.status);
  };

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      if (isStaleSubscriptionEvent(sub)) return current;
      const ids = {
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
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
      if (isStaleSubscriptionEvent(sub)) return current;
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
      const subId = invoiceSubscription(event.data.object);
      if (!subId || isOutdated(subId)) return current;
      return resolve({
        subscriptionActive: true,
        stripeStatus: "active",
        stripeSubscriptionId: subId,
        graceEndsAt: null,
      });
    }
    case "invoice.payment_failed": {
      // Stripe keeps retrying leftover invoices after a subscription is
      // cancelled, expired, paused, or never got past its first payment. None
      // of those owe the user Pro: the event changes nothing, so the webhook
      // sends no dunning mail either. Only a live (or not yet recorded)
      // subscription enters dunning here.
      if (NO_DUNNING_STATUSES.has(current.stripeStatus ?? "")) return current;
      const subId = invoiceSubscription(event.data.object);
      if (!subId || isOutdated(subId)) return current;
      return resolve({
        subscriptionActive: false,
        stripeStatus: "past_due",
        stripeSubscriptionId: subId,
        graceEndsAt: keepOrOpenGrace(),
      });
    }
    default: {
      // TS exhaustiveness check; explicit "no-op" for unknown events.
      return current;
    }
  }
}
