import { PRO_PRICES } from "@/lib/billing/plans";
import { setStripeForTesting } from "@/lib/billing/stripe";
import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

beforeEach(() => {
  __resetRateLimits();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly_test");
  vi.stubEnv("STRIPE_PRICE_YEARLY", "price_yearly_test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.example");
});

afterEach(() => {
  setStripeForTesting(null);
});

async function post(cookie?: string, body: unknown = { cadence: "monthly" }) {
  const { POST } = await import("@/app/api/stripe/checkout/route");
  return POST(
    new Request("http://localhost/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * A Stripe double that answers the three calls checkout makes. Prices come
 * back matching `PRO_PRICES` unless a test overrides one.
 */
function fakeStripe(overrides: { prices?: Record<string, Partial<Stripe.Price>> } = {}) {
  const calls = {
    customersCreate: [] as Stripe.CustomerCreateParams[],
    sessionsCreate: [] as Stripe.Checkout.SessionCreateParams[],
    pricesRetrieve: [] as string[],
  };
  const defaults: Record<string, Partial<Stripe.Price>> = {
    price_monthly_test: {
      id: "price_monthly_test",
      active: true,
      unit_amount: PRO_PRICES.monthly.amountCents,
      currency: "usd",
      tax_behavior: "exclusive",
      recurring: { interval: "month", interval_count: 1 } as Stripe.Price.Recurring,
    },
    price_yearly_test: {
      id: "price_yearly_test",
      active: true,
      unit_amount: PRO_PRICES.yearly.amountCents,
      currency: "usd",
      tax_behavior: "exclusive",
      recurring: { interval: "year", interval_count: 1 } as Stripe.Price.Recurring,
    },
  };
  const stripe = {
    customers: {
      async create(params: Stripe.CustomerCreateParams) {
        calls.customersCreate.push(params);
        return { id: `cus_${calls.customersCreate.length}` };
      },
    },
    prices: {
      async retrieve(id: string) {
        calls.pricesRetrieve.push(id);
        return { ...defaults[id], ...overrides.prices?.[id] };
      },
    },
    checkout: {
      sessions: {
        async create(params: Stripe.Checkout.SessionCreateParams) {
          calls.sessionsCreate.push(params);
          return { id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test" };
        },
      },
    },
  };
  setStripeForTesting(stripe as unknown as Stripe);
  return calls;
}

describe("POST /api/stripe/checkout", () => {
  it("requires a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("rejects an unknown cadence", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "c@example.com" });
    expect((await post(cookie, { cadence: "weekly" })).status).toBe(400);
  });

  it("503s with the missing env vars when billing is not configured, before touching Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_YEARLY", "");
    const calls = fakeStripe();
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "nc@example.com" });
    const res = await post(cookie, { cadence: "yearly" });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("billing_not_configured");
    expect(json.error).toMatch(/STRIPE_SECRET_KEY, STRIPE_PRICE_YEARLY/);
    expect(calls.sessionsCreate).toHaveLength(0);
  });

  it("refuses a second checkout while Stripe already bills, even for a comped user", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "paying@example.com" });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      tier: "comped",
      subscriptionActive: true,
      compedAt: new Date().toISOString(),
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
    });
    const res = await post(cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already have a subscription/i);
  });

  it("refuses a new checkout during dunning: the portal is the fix for a failed card", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "dun@example.com" });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      tier: "free",
      subscriptionActive: false,
      stripeCustomerId: "cus_2",
      stripeSubscriptionId: "sub_2",
      stripeStatus: "past_due",
    });
    expect((await post(cookie)).status).toBe(409);
  });

  it("allows checkout again after the subscription was cancelled", async () => {
    const repos = getTestRepos();
    const calls = fakeStripe();
    const { user, cookie } = await createUserWithCookie(repos, { email: "back@example.com" });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      tier: "free",
      stripeCustomerId: "cus_old",
      stripeSubscriptionId: "sub_old",
      stripeStatus: "canceled",
    });
    const res = await post(cookie, { cadence: "yearly" });
    expect(res.status).toBe(200);
    expect(calls.customersCreate).toHaveLength(0);
    expect(calls.sessionsCreate[0]!.customer).toBe("cus_old");
  });

  it("creates the customer, pins it, and opens a taxed, promo-enabled subscription session", async () => {
    const repos = getTestRepos();
    const calls = fakeStripe();
    const { user, cookie } = await createUserWithCookie(repos, { email: "new@example.com" });
    // Lapsed trial: billed immediately.
    const ent = (await repos.entitlements.get(user.id))!;
    await repos.entitlements.upsert(user.id, {
      ...ent,
      trialEndsAt: new Date(Date.now() - 864e5).toISOString(),
    });

    const res = await post(cookie, { cadence: "monthly" });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    expect(calls.customersCreate[0]).toMatchObject({
      email: "new@example.com",
      metadata: { userId: user.id },
    });
    expect((await repos.entitlements.get(user.id))?.stripeCustomerId).toBe("cus_1");
    expect((await repos.users.findByStripeCustomerId("cus_1"))?.id).toBe(user.id);

    const session = calls.sessionsCreate[0]!;
    expect(session).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      line_items: [{ price: "price_monthly_test", quantity: 1 }],
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: true },
      client_reference_id: user.id,
      success_url: "https://sifty.example/settings/billing?checkout=success",
      cancel_url: "https://sifty.example/settings/billing?checkout=cancelled",
    });
    expect(session.subscription_data?.metadata).toEqual({ userId: user.id });
    expect(session.subscription_data?.trial_end).toBeUndefined();
  });

  it("honours the remaining app trial as a Stripe trial_end", async () => {
    const repos = getTestRepos();
    const calls = fakeStripe();
    const { user, cookie } = await createUserWithCookie(repos, { email: "trial@example.com" });
    const trialEndsAt = (await repos.entitlements.get(user.id))!.trialEndsAt!;
    expect((await post(cookie)).status).toBe(200);
    expect(calls.sessionsCreate[0]!.subscription_data?.trial_end).toBe(
      Math.floor(Date.parse(trialEndsAt) / 1000),
    );
  });

  it("bills now when less than 48h of trial remain", async () => {
    const repos = getTestRepos();
    const calls = fakeStripe();
    const { user, cookie } = await createUserWithCookie(repos, { email: "late@example.com" });
    const ent = (await repos.entitlements.get(user.id))!;
    await repos.entitlements.upsert(user.id, {
      ...ent,
      trialEndsAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
    expect((await post(cookie)).status).toBe(200);
    expect(calls.sessionsCreate[0]!.subscription_data?.trial_end).toBeUndefined();
  });

  it("refuses to sell when the Stripe price disagrees with lib/billing/plans.ts", async () => {
    const calls = fakeStripe({ prices: { price_monthly_test: { unit_amount: 1_200 } } });
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "drift@example.com" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(cookie);
    errors.mockRestore();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/misconfigured/i);
    expect(json.detail).toMatch(/1200 cents, plan says 1000 \(\$10\)/);
    expect(calls.sessionsCreate).toHaveLength(0);
    expect(calls.customersCreate).toHaveLength(0);
  });

  it("refuses an archived price or a wrong interval", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "arch@example.com" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeStripe({ prices: { price_monthly_test: { active: false } } });
    expect((await post(cookie)).status).toBe(503);
    fakeStripe({
      prices: {
        price_yearly_test: {
          recurring: { interval: "month", interval_count: 12 } as Stripe.Price.Recurring,
        },
      },
    });
    const res = await post(cookie, { cadence: "yearly" });
    errors.mockRestore();
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toMatch(/interval is 12 month, plan says 1 year/);
  });

  it("verifies each price once per process", async () => {
    const repos = getTestRepos();
    const calls = fakeStripe();
    const a = await createUserWithCookie(repos, { email: "a@example.com" });
    const b = await createUserWithCookie(repos, { email: "b@example.com" });
    expect((await post(a.cookie)).status).toBe(200);
    expect((await post(b.cookie)).status).toBe(200);
    expect(calls.pricesRetrieve).toEqual(["price_monthly_test"]);
  });
});
