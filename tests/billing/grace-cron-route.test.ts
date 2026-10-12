import { applyStripeEvent } from "@/lib/billing/events";
import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const DAY = 24 * 60 * 60 * 1000;

async function get(authorization?: string) {
  const { GET } = await import("@/app/api/cron/expire-grace-periods/route");
  return GET(
    new Request("http://localhost/api/cron/expire-grace-periods", {
      headers: authorization ? { authorization } : {},
    }),
  );
}

describe("GET /api/cron/expire-grace-periods", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret-test");
  });

  it("503s with a clear message when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await get("Bearer anything");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/CRON_SECRET/);
  });

  it("401s without the bearer secret", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
  });

  it("expires overdue grace periods and reports counts", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "cron@example.com",
      displayName: "Cron",
      isCreator: false,
    });
    const longAgo = new Date(Date.now() - 30 * DAY);
    await repos.entitlements.upsert(
      user.id,
      applyStripeEvent(
        {
          ...emptySnapshot(),
          tier: "pro",
          subscriptionActive: true,
          stripeCustomerId: "cus_cron",
          stripeSubscriptionId: "sub_cron",
          stripeStatus: "active",
        },
        {
          type: "invoice.payment_failed",
          created: Math.floor(longAgo.getTime() / 1000),
          data: { object: { customer: "cus_cron", subscription: "sub_cron" } },
        },
      ),
    );

    const res = await get("Bearer cron-secret-test");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, expired: 1, skipped: 0, failed: 0 });
    expect((await repos.entitlements.get(user.id))?.tier).toBe("free");
  });
});
