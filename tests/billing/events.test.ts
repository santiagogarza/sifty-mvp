import { type ReducibleEvent, applyStripeEvent } from "@/lib/billing/events";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import { creatorSnapshot, emptySnapshot, trialSnapshot } from "@/lib/entitlements/entitlements";
import { describe, expect, it } from "vitest";

const DAY = 24 * 60 * 60 * 1000;

function trial(): EntitlementSnapshot {
  return { ...trialSnapshot(), stripeCustomerId: "cus_X" };
}

function lapsedTrial(): EntitlementSnapshot {
  const started = new Date(Date.now() - 40 * DAY);
  return { ...trialSnapshot(30, started), tier: "free", stripeCustomerId: "cus_X" };
}

function comped(): EntitlementSnapshot {
  return {
    ...emptySnapshot(),
    tier: "comped",
    compedAt: new Date(Date.now() - DAY).toISOString(),
    compedUntil: null,
    stripeCustomerId: "cus_X",
  };
}

function subEvent(
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  status: string,
): ReducibleEvent {
  return {
    type,
    data: {
      object: {
        id: "sub_test",
        status,
        current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000),
        customer: "cus_X",
      },
    },
  };
}

describe("applyStripeEvent", () => {
  it("subscription.created (active) → pro, subscriptionActive", () => {
    const start = trial();
    const next = applyStripeEvent(start, subEvent("customer.subscription.created", "active"));
    expect(next.tier).toBe("pro");
    expect(next.subscriptionActive).toBe(true);
    expect(next.stripeSubscriptionId).toBe("sub_test");
    // Trial dates are kept for history.
    expect(next.trialEndsAt).toBe(start.trialEndsAt);
  });

  it("subscription.updated (Stripe trialing) → pro", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.updated", "trialing"));
    expect(next.tier).toBe("pro");
  });

  it("subscription.updated (past_due) during our trial → back to trialing, not dead", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.updated", "past_due"));
    expect(next.subscriptionActive).toBe(false);
    expect(next.tier).toBe("trialing");
    expect(next.stripeStatus).toBe("past_due");
  });

  it("subscription.deleted after the trial lapsed → free, period cleared", () => {
    const active = applyStripeEvent(
      lapsedTrial(),
      subEvent("customer.subscription.created", "active"),
    );
    expect(active.tier).toBe("pro");
    const next = applyStripeEvent(active, subEvent("customer.subscription.deleted", "canceled"));
    expect(next.tier).toBe("free");
    expect(next.subscriptionActive).toBe(false);
    expect(next.currentPeriodEnd).toBeNull();
  });

  it("invoice.payment_failed → subscription inactive, stripeStatus past_due", () => {
    const next = applyStripeEvent(lapsedTrial(), {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_X" } },
    });
    expect(next.tier).toBe("free");
    expect(next.subscriptionActive).toBe(false);
    expect(next.stripeStatus).toBe("past_due");
  });

  it("invoice.paid is a no-op for the entitlement (subscription event drives state)", () => {
    const before = trial();
    const next = applyStripeEvent(before, {
      type: "invoice.paid",
      data: { object: { customer: "cus_X" } },
    });
    expect(next).toEqual(before);
  });

  it("comped precedence: a Stripe cancellation never strips an invite comp", () => {
    const start = comped();
    const paying = applyStripeEvent(start, subEvent("customer.subscription.created", "active"));
    expect(paying.tier).toBe("comped");
    expect(paying.subscriptionActive).toBe(true);

    const cancelled = applyStripeEvent(
      paying,
      subEvent("customer.subscription.deleted", "canceled"),
    );
    expect(cancelled.tier).toBe("comped");
    expect(cancelled.subscriptionActive).toBe(false);
    expect(cancelled.compedAt).toBe(start.compedAt);
  });

  it("creator entitlement is sticky across every event type", () => {
    const before = creatorSnapshot();
    for (const status of ["active", "past_due", "canceled"]) {
      const next = applyStripeEvent(before, subEvent("customer.subscription.deleted", status));
      expect(next).toEqual(before);
    }
    const failed = applyStripeEvent(before, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_X" } },
    });
    expect(failed).toEqual(before);
  });

  it("is deterministic — repeating the same event yields the same state", () => {
    const start = trial();
    const event = subEvent("customer.subscription.created", "active");
    const a = applyStripeEvent(start, event);
    const b = applyStripeEvent(applyStripeEvent(start, event), event);
    expect(a).toEqual(b);
  });
});
