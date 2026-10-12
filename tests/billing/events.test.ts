import {
  type ReducibleEvent,
  applyStripeEvent,
  hasOpenStripeSubscription,
} from "@/lib/billing/events";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import {
  GRACE_PERIOD_DAYS,
  creatorSnapshot,
  emptySnapshot,
  trialSnapshot,
} from "@/lib/entitlements/entitlements";
import { describe, expect, it } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-12T12:00:00.000Z");
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

function paying(): EntitlementSnapshot {
  return {
    ...emptySnapshot(),
    tier: "pro",
    subscriptionActive: true,
    stripeCustomerId: "cus_X",
    stripeSubscriptionId: "sub_test",
    stripeStatus: "active",
    currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY).toISOString(),
  };
}

function failed(at: Date = NOW): ReducibleEvent {
  return {
    type: "invoice.payment_failed",
    created: unix(at),
    data: { object: { customer: "cus_X", subscription: "sub_test", amount_due: 1000 } },
  };
}

function paid(at: Date = NOW): ReducibleEvent {
  return {
    type: "invoice.paid",
    created: unix(at),
    data: { object: { customer: "cus_X", subscription: "sub_test" } },
  };
}

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

  it("subscription.updated (past_due) during our trial → grace keeps pro, trial stays underneath", () => {
    const start = trial();
    const next = applyStripeEvent(start, subEvent("customer.subscription.updated", "past_due"));
    expect(next.subscriptionActive).toBe(false);
    expect(next.tier).toBe("pro");
    expect(next.stripeStatus).toBe("past_due");
    expect(next.graceEndsAt).not.toBeNull();
    expect(next.trialEndsAt).toBe(start.trialEndsAt);
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

  it("invoice.payment_failed with no prior subscription → inactive, past_due, grace opens", () => {
    const next = applyStripeEvent(
      lapsedTrial(),
      { type: "invoice.payment_failed", data: { object: { customer: "cus_X" } } },
      NOW,
    );
    // Grace keeps Pro on for the window even when nothing was active before:
    // Stripe only invoices customers who had a subscription.
    expect(next.tier).toBe("pro");
    expect(next.subscriptionActive).toBe(false);
    expect(next.stripeStatus).toBe("past_due");
    expect(next.graceEndsAt).toBe(new Date(NOW.getTime() + GRACE_PERIOD_DAYS * DAY).toISOString());
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

describe("applyStripeEvent — dunning grace period", () => {
  const graceEnd = new Date(NOW.getTime() + GRACE_PERIOD_DAYS * DAY).toISOString();

  it("payment_failed on a paying user keeps Pro for the grace window", () => {
    const next = applyStripeEvent(paying(), failed(), NOW);
    expect(next.subscriptionActive).toBe(false);
    expect(next.stripeStatus).toBe("past_due");
    expect(next.graceEndsAt).toBe(graceEnd);
    expect(next.tier).toBe("pro");
  });

  it("takes the clock from event.created, not from the wall clock", () => {
    const later = new Date(NOW.getTime() + 3 * DAY);
    const next = applyStripeEvent(paying(), failed(later), new Date(0));
    expect(next.graceEndsAt).toBe(
      new Date(later.getTime() + GRACE_PERIOD_DAYS * DAY).toISOString(),
    );
  });

  it("subscription.updated(past_due) opens the same window and later failures do not extend it", () => {
    const first = applyStripeEvent(
      paying(),
      { ...subEvent("customer.subscription.updated", "past_due"), created: unix(NOW) },
      NOW,
    );
    expect(first.graceEndsAt).toBe(graceEnd);
    expect(first.tier).toBe("pro");

    const retry = applyStripeEvent(first, failed(new Date(NOW.getTime() + 4 * DAY)));
    expect(retry.graceEndsAt).toBe(graceEnd);
    const retryStatus = applyStripeEvent(retry, {
      ...subEvent("customer.subscription.updated", "unpaid"),
      created: unix(new Date(NOW.getTime() + 6 * DAY)),
    });
    expect(retryStatus.graceEndsAt).toBe(graceEnd);
    expect(retryStatus.stripeStatus).toBe("unpaid");
  });

  it("after the cron cleared an expired window, retries in the same cycle do not reopen it", () => {
    const inGrace = applyStripeEvent(paying(), failed(), NOW);
    // What expireGracePeriods() persists: timestamp gone, status still dunning.
    const expired: EntitlementSnapshot = { ...inGrace, graceEndsAt: null, tier: "free" };
    const afterWindow = new Date(NOW.getTime() + (GRACE_PERIOD_DAYS + 3) * DAY);

    const retry = applyStripeEvent(expired, failed(afterWindow));
    expect(retry.graceEndsAt).toBeNull();
    expect(retry.tier).toBe("free");

    const unpaid = applyStripeEvent(expired, {
      ...subEvent("customer.subscription.updated", "unpaid"),
      created: unix(afterWindow),
    });
    expect(unpaid.graceEndsAt).toBeNull();
    expect(unpaid.tier).toBe("free");

    // A real recovery still restores Pro, and a fresh cycle after it gets a new window.
    const recovered = applyStripeEvent(unpaid, paid(afterWindow));
    expect(recovered.tier).toBe("pro");
    const nextCycle = applyStripeEvent(recovered, failed(new Date(afterWindow.getTime() + DAY)));
    expect(nextCycle.graceEndsAt).toBe(
      new Date(afterWindow.getTime() + DAY + GRACE_PERIOD_DAYS * DAY).toISOString(),
    );
    expect(nextCycle.tier).toBe("pro");
  });

  it("once the window has passed the resolved tier is free, with the facts intact", () => {
    const inGrace = applyStripeEvent(paying(), failed(), NOW);
    const afterWindow = new Date(NOW.getTime() + (GRACE_PERIOD_DAYS + 1) * DAY);
    const next = applyStripeEvent(inGrace, failed(afterWindow));
    expect(next.graceEndsAt).toBe(graceEnd);
    expect(next.tier).toBe("free");
  });

  it("subscription.updated(active) after recovery clears the grace window", () => {
    const inGrace = applyStripeEvent(paying(), failed(), NOW);
    const next = applyStripeEvent(inGrace, subEvent("customer.subscription.updated", "active"));
    expect(next.subscriptionActive).toBe(true);
    expect(next.graceEndsAt).toBeNull();
    expect(next.tier).toBe("pro");
  });

  it("invoice.paid during dunning recovers even if it beats subscription.updated", () => {
    const inGrace = applyStripeEvent(paying(), failed(), NOW);
    const next = applyStripeEvent(inGrace, paid(new Date(NOW.getTime() + DAY)));
    expect(next.subscriptionActive).toBe(true);
    expect(next.stripeStatus).toBe("active");
    expect(next.graceEndsAt).toBeNull();
    expect(next.tier).toBe("pro");
  });

  it("subscription.deleted during grace ends Pro immediately", () => {
    const inGrace = applyStripeEvent(paying(), failed(), NOW);
    const next = applyStripeEvent(inGrace, subEvent("customer.subscription.deleted", "canceled"));
    expect(next.graceEndsAt).toBeNull();
    expect(next.subscriptionActive).toBe(false);
    expect(next.currentPeriodEnd).toBeNull();
    expect(next.stripeStatus).toBe("canceled");
    expect(next.tier).toBe("free");
  });

  it("subscription.deleted keeps the trial if our own trial window is still open", () => {
    const start = applyStripeEvent(trial(), subEvent("customer.subscription.created", "active"));
    const next = applyStripeEvent(start, subEvent("customer.subscription.deleted", "canceled"));
    expect(next.tier).toBe("trialing");
    expect(next.trialEndsAt).toBe(start.trialEndsAt);
  });

  it("incomplete / incomplete_expired / paused never open a grace window", () => {
    for (const status of ["incomplete", "incomplete_expired", "paused"]) {
      const next = applyStripeEvent(
        lapsedTrial(),
        subEvent("customer.subscription.updated", status),
        NOW,
      );
      expect(next.graceEndsAt).toBeNull();
      expect(next.subscriptionActive).toBe(false);
      expect(next.tier).toBe("free");
    }
  });

  it("comped precedence: dunning and expiry never touch a comped user's tier", () => {
    const inGrace = applyStripeEvent(
      { ...comped(), subscriptionActive: true, stripeSubscriptionId: "sub_test" },
      failed(),
      NOW,
    );
    expect(inGrace.tier).toBe("comped");
    expect(inGrace.graceEndsAt).toBe(graceEnd);
    const afterWindow = new Date(NOW.getTime() + (GRACE_PERIOD_DAYS + 1) * DAY);
    const expired = applyStripeEvent(inGrace, failed(afterWindow));
    expect(expired.tier).toBe("comped");
  });

  it("Stripe trialing (card on file, trial_end set) counts as paying; paused at trial end does not", () => {
    const trialing = applyStripeEvent(
      lapsedTrial(),
      subEvent("customer.subscription.created", "trialing"),
      NOW,
    );
    expect(trialing.tier).toBe("pro");
    expect(trialing.subscriptionActive).toBe(true);
    const paused = applyStripeEvent(trialing, subEvent("customer.subscription.updated", "paused"));
    expect(paused.tier).toBe("free");
    expect(paused.graceEndsAt).toBeNull();
    const converted = applyStripeEvent(
      trialing,
      subEvent("customer.subscription.updated", "active"),
    );
    expect(converted.tier).toBe("pro");
  });
});

describe("hasOpenStripeSubscription", () => {
  it("is true while paying, in dunning, or incomplete; false once ended or never started", () => {
    expect(hasOpenStripeSubscription(null)).toBe(false);
    expect(hasOpenStripeSubscription(emptySnapshot())).toBe(false);
    expect(hasOpenStripeSubscription(paying())).toBe(true);
    expect(hasOpenStripeSubscription(applyStripeEvent(paying(), failed(), NOW))).toBe(true);
    for (const status of ["unpaid", "incomplete", "paused"]) {
      expect(
        hasOpenStripeSubscription({
          ...paying(),
          subscriptionActive: false,
          stripeStatus: status,
        }),
      ).toBe(true);
    }
    for (const status of ["canceled", "incomplete_expired"]) {
      expect(
        hasOpenStripeSubscription({
          ...paying(),
          subscriptionActive: false,
          stripeStatus: status,
        }),
      ).toBe(false);
    }
  });
});
