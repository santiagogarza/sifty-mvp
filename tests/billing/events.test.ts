import { type ReducibleEvent, applyStripeEvent } from "@/lib/billing/events";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import { describe, expect, it } from "vitest";

function trial(): EntitlementSnapshot {
  return {
    tier: "trialing",
    trialStartedAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    subscriptionActive: false,
    stripeCustomerId: "cus_X",
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    aiRunsLimitDay: 50,
  };
}

function creator(): EntitlementSnapshot {
  return {
    tier: "creator",
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionActive: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    aiRunsLimitDay: 1_000_000,
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
        current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
        customer: "cus_X",
      },
    },
  };
}

describe("applyStripeEvent", () => {
  it("subscription.created (active) → tier active, 200/day cap", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.created", "active"));
    expect(next.tier).toBe("active");
    expect(next.aiRunsLimitDay).toBe(200);
    expect(next.subscriptionActive).toBe(true);
  });

  it("subscription.updated (trialing) → active", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.updated", "trialing"));
    expect(next.tier).toBe("active");
  });

  it("subscription.updated (past_due) → expired, 0 cap", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.updated", "past_due"));
    expect(next.tier).toBe("expired");
    expect(next.aiRunsLimitDay).toBe(0);
  });

  it("subscription.deleted → expired, 0 cap, current period cleared", () => {
    const next = applyStripeEvent(trial(), subEvent("customer.subscription.deleted", "canceled"));
    expect(next.tier).toBe("expired");
    expect(next.aiRunsLimitDay).toBe(0);
    expect(next.currentPeriodEnd).toBeNull();
  });

  it("invoice.payment_failed → expired", () => {
    const next = applyStripeEvent(trial(), {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_X" } },
    });
    expect(next.tier).toBe("expired");
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

  it("creator entitlement is sticky across every event type", () => {
    const before = creator();
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
