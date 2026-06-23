import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const WEBHOOK_SECRET = "whsec_test_abcdefghijklmnopqrstuvwxyz0123456789";

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function signed(body: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)) {
  return Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
    timestamp,
  });
}

async function importRoute() {
  const mod = await import("@/app/api/stripe/webhook/route");
  return mod.POST;
}

interface MakeEventOptions {
  type: string;
  customer?: string;
  subscriptionId?: string;
  status?: string;
  id?: string;
}

function makeEvent(opts: MakeEventOptions): { id: string; body: string } {
  const id = opts.id ?? `evt_${Math.random().toString(36).slice(2, 12)}`;
  const obj =
    opts.type === "invoice.payment_failed" || opts.type === "invoice.paid"
      ? { customer: opts.customer ?? "cus_X", status: opts.status ?? "paid" }
      : {
          id: opts.subscriptionId ?? "sub_X",
          status: opts.status ?? "active",
          current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          customer: opts.customer ?? "cus_X",
        };
  const body = JSON.stringify({
    id,
    object: "event",
    type: opts.type,
    data: { object: obj },
  });
  return { id, body };
}

describe("POST /api/stripe/webhook", () => {
  it("rejects requests with no signature", async () => {
    const POST = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects tampered bodies", async () => {
    const POST = await importRoute();
    const { body } = makeEvent({ type: "customer.subscription.created" });
    const sig = signed(body, WEBHOOK_SECRET);
    const tampered = body.replace("active", "trialing");

    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": sig },
        body: tampered,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("activates entitlement on subscription.created and is idempotent on replay", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u@example.com",
      passwordHash: null,
      displayName: "U",
      isCreator: false,
    });
    await repos.entitlements.startTrialIfMissing(user.id, 30);
    await repos.users.setStripeCustomerId(user.id, "cus_X");
    // Pin customer id on the entitlement snapshot too so the in-memory
    // lookup finds it. Real Postgres reads users.stripe_customer_id.
    const ent = await repos.entitlements.get(user.id);
    if (ent) await repos.entitlements.upsert(user.id, { ...ent, stripeCustomerId: "cus_X" });

    const POST = await importRoute();
    const { id, body } = makeEvent({
      type: "customer.subscription.created",
      customer: "cus_X",
      status: "active",
    });
    const sig = signed(body, WEBHOOK_SECRET);

    const res1 = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": sig },
        body,
      }),
    );
    expect(res1.status).toBe(200);

    const after = await repos.entitlements.get(user.id);
    expect(after?.tier).toBe("active");
    expect(after?.aiRunsLimitDay).toBe(200);

    // Replay — same event id. Should 200 without changing state.
    const res2 = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": sig },
        body,
      }),
    );
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.deduped).toBe(true);

    const final = await repos.entitlements.get(user.id);
    expect(final?.tier).toBe("active");
    expect(final?.stripeSubscriptionId).toBe("sub_X");
    void id;
  });

  it("subscription.deleted flips entitlement to expired", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u2@example.com",
      passwordHash: null,
      displayName: "U2",
      isCreator: false,
    });
    await repos.entitlements.upsert(user.id, {
      tier: "active",
      trialStartedAt: null,
      trialEndsAt: null,
      subscriptionActive: true,
      stripeCustomerId: "cus_Y",
      stripeSubscriptionId: "sub_Y",
      stripeStatus: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      aiRunsLimitDay: 200,
    });
    await repos.users.setStripeCustomerId(user.id, "cus_Y");

    const POST = await importRoute();
    const { body } = makeEvent({
      type: "customer.subscription.deleted",
      customer: "cus_Y",
      subscriptionId: "sub_Y",
      status: "canceled",
    });
    const sig = signed(body, WEBHOOK_SECRET);

    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": sig },
        body,
      }),
    );
    expect(res.status).toBe(200);

    const after = await repos.entitlements.get(user.id);
    expect(after?.tier).toBe("expired");
    expect(after?.aiRunsLimitDay).toBe(0);
  });
});
