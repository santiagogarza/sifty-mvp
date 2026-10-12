import { getStripe } from "@/lib/billing/stripe";
import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

vi.mock("@/lib/billing/stripe", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/billing/stripe")>("@/lib/billing/stripe");
  return { ...actual, getStripe: vi.fn(actual.getStripe) };
});

beforeEach(() => {
  __resetRateLimits();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly_test");
});

/** A Stripe client that creates a customer and a Checkout session without the network. */
function stubStripe() {
  const customers = { create: vi.fn(async () => ({ id: "cus_new" })) };
  const sessions = { create: vi.fn(async () => ({ url: "https://checkout.stripe.test/s" })) };
  vi.mocked(getStripe).mockReturnValue({
    customers,
    checkout: { sessions },
  } as unknown as ReturnType<typeof getStripe>);
  return { customers, sessions };
}

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

describe("POST /api/stripe/checkout", () => {
  it("requires a session", async () => {
    expect((await post()).status).toBe(401);
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
    expect((await res.json()).error).toMatch(/already have an active subscription/i);
  });

  it("pins the new customer id without granting anything to an account that has no entitlement row", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "norow@example.com" });
    // An account from before the entitlements table existed.
    const handle = getTestRepos();
    handle.__state().entitlements.delete(user.id);
    expect(await repos.entitlements.get(user.id)).toBeNull();

    const { sessions } = stubStripe();
    const res = await post(cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/^https:\/\/checkout/);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_new", client_reference_id: user.id }),
    );

    const ent = await repos.entitlements.get(user.id);
    expect(ent?.stripeCustomerId).toBe("cus_new");
    // Starting a checkout is not a payment: no trial, no Pro.
    expect(ent?.tier).toBe("free");
    expect(ent?.trialEndsAt).toBeNull();
    expect(ent?.subscriptionActive).toBe(false);
  });

  it("503s with the missing price name when the cadence is not configured", async () => {
    vi.stubEnv("STRIPE_PRICE_YEARLY", "");
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "trial@example.com" });
    const res = await post(cookie, { cadence: "yearly" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/STRIPE_PRICE_YEARLY/);
  });
});
