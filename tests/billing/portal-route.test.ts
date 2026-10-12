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
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.example");
});

afterEach(() => {
  setStripeForTesting(null);
});

async function post(cookie?: string) {
  const { POST } = await import("@/app/api/stripe/portal/route");
  return POST(
    new Request("http://localhost/api/stripe/portal", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    }),
  );
}

describe("POST /api/stripe/portal", () => {
  it("requires a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("503s with billing_not_configured when there is no secret key", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "p1@example.com" });
    const res = await post(cookie);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("billing_not_configured");
  });

  it("400s for an account that never reached Stripe", async () => {
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "p2@example.com" });
    const res = await post(cookie);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No Stripe customer/);
  });

  it("opens a portal session for any Stripe customer, including a cancelled one", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "p3@example.com" });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      stripeCustomerId: "cus_old",
      stripeSubscriptionId: "sub_old",
      stripeStatus: "canceled",
    });
    const calls: Stripe.BillingPortal.SessionCreateParams[] = [];
    setStripeForTesting({
      billingPortal: {
        sessions: {
          async create(params: Stripe.BillingPortal.SessionCreateParams) {
            calls.push(params);
            return { url: "https://billing.stripe.com/p/session/test" };
          },
        },
      },
    } as unknown as Stripe);
    const res = await post(cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toMatch(/^https:\/\/billing\.stripe\.com\//);
    expect(calls[0]).toMatchObject({
      customer: "cus_old",
      return_url: "https://sifty.example/settings/billing",
    });
  });

  it("500s and reports when Stripe fails", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "p4@example.com" });
    await repos.entitlements.upsert(user.id, { ...emptySnapshot(), stripeCustomerId: "cus_x" });
    setStripeForTesting({
      billingPortal: {
        sessions: {
          async create() {
            throw new Error("stripe down");
          },
        },
      },
    } as unknown as Stripe);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(cookie);
    errors.mockRestore();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/couldn't reach Stripe/);
    expect(json.detail).toBe("stripe down");
  });
});
