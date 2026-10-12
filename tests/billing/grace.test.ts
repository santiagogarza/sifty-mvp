import { applyStripeEvent } from "@/lib/billing/events";
import { expireGracePeriods } from "@/lib/billing/grace";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import {
  GRACE_PERIOD_DAYS,
  deriveEntitlement,
  emptySnapshot,
  paymentProblem,
} from "@/lib/entitlements/entitlements";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const DAY = 24 * 60 * 60 * 1000;
const FAILED_AT = new Date("2026-10-12T12:00:00.000Z");
const GRACE_END = new Date(FAILED_AT.getTime() + GRACE_PERIOD_DAYS * DAY);
const AFTER = new Date(GRACE_END.getTime() + DAY);

function paying(customer: string): EntitlementSnapshot {
  return {
    ...emptySnapshot(),
    tier: "pro",
    subscriptionActive: true,
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${customer}`,
    stripeStatus: "active",
    currentPeriodEnd: new Date(FAILED_AT.getTime() + 20 * DAY).toISOString(),
  };
}

function inGrace(customer: string): EntitlementSnapshot {
  return applyStripeEvent(
    paying(customer),
    {
      type: "invoice.payment_failed",
      created: Math.floor(FAILED_AT.getTime() / 1000),
      data: { object: { customer } },
    },
    FAILED_AT,
  );
}

async function userWith(email: string, snapshot: EntitlementSnapshot, isCreator = false) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email,
    displayName: email,
    isCreator,
  });
  await repos.entitlements.upsert(user.id, snapshot);
  return user;
}

describe("expireGracePeriods", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("drops users whose grace ended to free and leaves open windows alone", async () => {
    const repos = getTestRepos();
    const expired = await userWith("expired@example.com", inGrace("cus_1"));
    const open = await userWith("open@example.com", {
      ...inGrace("cus_2"),
      graceEndsAt: new Date(AFTER.getTime() + 2 * DAY).toISOString(),
    });

    const stillOpen = await expireGracePeriods(repos, new Date(GRACE_END.getTime() - 1));
    expect(stillOpen).toEqual({ expired: [], skipped: [], failed: [] });

    const result = await expireGracePeriods(repos, AFTER);
    expect(result).toEqual({ expired: [expired.id], skipped: [], failed: [] });
    expect((await repos.entitlements.get(open.id))?.tier).toBe("pro");

    const after = await repos.entitlements.get(expired.id);
    expect(after?.tier).toBe("free");
    expect(after?.graceEndsAt).toBeNull();
    expect(after?.subscriptionActive).toBe(false);
    // Stripe facts stay so the portal and the "lapsed" banner still work.
    expect(after?.stripeStatus).toBe("past_due");
    expect(after?.stripeSubscriptionId).toBe("sub_cus_1");
  });

  it("is idempotent: a second run finds nothing", async () => {
    const repos = getTestRepos();
    await userWith("once@example.com", inGrace("cus_3"));
    expect((await expireGracePeriods(repos, AFTER)).expired).toHaveLength(1);
    expect(await expireGracePeriods(repos, AFTER)).toEqual({
      expired: [],
      skipped: [],
      failed: [],
    });
  });

  it("readers already see free once the window passed, before the cron runs", async () => {
    const repos = getTestRepos();
    const user = await userWith("reader@example.com", inGrace("cus_4"));
    const snapshot = await repos.entitlements.get(user.id);
    expect(deriveEntitlement({ profile: user, snapshot, now: GRACE_END }).tier).toBe("free");
    expect(
      deriveEntitlement({ profile: user, snapshot, now: new Date(GRACE_END.getTime() - 1) }).tier,
    ).toBe("pro");
  });

  it("keeps a comped user comped and a still-open trial trialing", async () => {
    const repos = getTestRepos();
    const comped = await userWith("comped@example.com", {
      ...inGrace("cus_5"),
      compedAt: FAILED_AT.toISOString(),
      compedUntil: null,
      tier: "comped",
    });
    const trial = await userWith("trial@example.com", {
      ...inGrace("cus_6"),
      trialStartedAt: FAILED_AT.toISOString(),
      trialEndsAt: new Date(AFTER.getTime() + 10 * DAY).toISOString(),
    });
    const result = await expireGracePeriods(repos, AFTER);
    expect(new Set(result.expired)).toEqual(new Set([comped.id, trial.id]));
    expect((await repos.entitlements.get(comped.id))?.tier).toBe("comped");
    expect((await repos.entitlements.get(trial.id))?.tier).toBe("trialing");
  });

  it("never downgrades the creator but still clears the stale window", async () => {
    const repos = getTestRepos();
    const creator = await userWith(
      "creator@example.com",
      { ...inGrace("cus_7"), tier: "creator" },
      true,
    );
    await expireGracePeriods(repos, AFTER);
    const after = await repos.entitlements.get(creator.id);
    expect(after?.tier).toBe("creator");
    expect(after?.graceEndsAt).toBeNull();
  });

  it("skips a user whose payment recovered between the listing and the lock", async () => {
    const repos = getTestRepos();
    const user = await userWith("raced@example.com", inGrace("cus_8"));
    const original = repos.entitlements.update.bind(repos.entitlements);
    vi.spyOn(repos.entitlements, "update").mockImplementationOnce(async (id, mutate) => {
      // Recovery webhook commits first.
      const ent = (await repos.entitlements.get(id))!;
      await repos.entitlements.upsert(id, {
        ...ent,
        subscriptionActive: true,
        stripeStatus: "active",
        graceEndsAt: null,
        tier: "pro",
      });
      return original(id, mutate);
    });
    const result = await expireGracePeriods(repos, AFTER);
    expect(result.skipped).toEqual([user.id]);
    expect(result.expired).toEqual([]);
    expect((await repos.entitlements.get(user.id))?.tier).toBe("pro");
  });

  it("skips an account deleted between the listing and the lock instead of resurrecting it", async () => {
    const repos = getTestRepos();
    const user = await userWith("gone@example.com", inGrace("cus_9"));
    const original = repos.entitlements.update.bind(repos.entitlements);
    vi.spyOn(repos.entitlements, "update").mockImplementationOnce(async (id, mutate) => {
      repos.__state().entitlements.delete(id);
      return original(id, mutate);
    });
    const result = await expireGracePeriods(repos, AFTER);
    expect(result).toEqual({ expired: [], skipped: [user.id], failed: [] });
    expect(await repos.entitlements.get(user.id)).toBeNull();
  });

  it("reports a failing row and keeps going", async () => {
    const repos = getTestRepos();
    const bad = await userWith("bad@example.com", inGrace("cus_10"));
    const good = await userWith("good@example.com", {
      ...inGrace("cus_11"),
      graceEndsAt: new Date(GRACE_END.getTime() + 60_000).toISOString(),
    });
    const original = repos.entitlements.update.bind(repos.entitlements);
    vi.spyOn(repos.entitlements, "update").mockImplementationOnce(async () => {
      throw new Error("deadlock");
    });
    vi.spyOn(repos.entitlements, "update").mockImplementation(original);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await expireGracePeriods(repos, AFTER);
    errors.mockRestore();
    expect(result.failed).toEqual([bad.id]);
    expect(result.expired).toEqual([good.id]);
  });

  it("respects the batch limit, oldest first", async () => {
    const repos = getTestRepos();
    const older = await userWith("older@example.com", {
      ...inGrace("cus_12"),
      graceEndsAt: new Date(GRACE_END.getTime() - DAY).toISOString(),
    });
    await userWith("newer@example.com", inGrace("cus_13"));
    const result = await expireGracePeriods(repos, AFTER, 1);
    expect(result.expired).toEqual([older.id]);
  });
});

describe("paymentProblem", () => {
  it("is null when billing is fine, and for comped or creator accounts", () => {
    expect(paymentProblem(null, false)).toBeNull();
    expect(paymentProblem(emptySnapshot(), false)).toBeNull();
    expect(paymentProblem(paying("cus_a"), false)).toBeNull();
    expect(paymentProblem(inGrace("cus_a"), true)).toBeNull();
    expect(
      paymentProblem(
        { ...inGrace("cus_a"), compedAt: FAILED_AT.toISOString(), compedUntil: null },
        false,
        FAILED_AT,
      ),
    ).toBeNull();
  });

  it("reports grace while the window is open and lapsed once it is not", () => {
    const snapshot = inGrace("cus_b");
    expect(paymentProblem(snapshot, false, FAILED_AT)).toEqual({
      kind: "grace",
      graceEndsAt: GRACE_END.toISOString(),
    });
    expect(paymentProblem(snapshot, false, AFTER)).toEqual({ kind: "lapsed" });
    expect(paymentProblem({ ...snapshot, graceEndsAt: null }, false, AFTER)).toEqual({
      kind: "lapsed",
    });
  });

  it("names the trial end instead of 'lapsed' while an open app trial still carries Pro", () => {
    const trialEnd = new Date(AFTER.getTime() + 10 * DAY).toISOString();
    const snapshot = { ...inGrace("cus_t"), trialEndsAt: trialEnd };
    expect(paymentProblem(snapshot, false, FAILED_AT)).toEqual({
      kind: "grace",
      graceEndsAt: GRACE_END.toISOString(),
    });
    expect(paymentProblem(snapshot, false, AFTER)).toEqual({
      kind: "grace",
      graceEndsAt: trialEnd,
    });
    expect(paymentProblem(snapshot, false, new Date(Date.parse(trialEnd) + DAY))).toEqual({
      kind: "lapsed",
    });
  });

  it("clears once the subscription recovers or is cancelled", () => {
    const snapshot = inGrace("cus_c");
    const recovered = applyStripeEvent(snapshot, {
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_cus_c",
          status: "active",
          current_period_end: Math.floor((AFTER.getTime() + 30 * DAY) / 1000),
          customer: "cus_c",
        },
      },
    });
    expect(paymentProblem(recovered, false, AFTER)).toBeNull();
    const cancelled = applyStripeEvent(snapshot, {
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_cus_c",
          status: "canceled",
          current_period_end: 0,
          customer: "cus_c",
        },
      },
    });
    expect(paymentProblem(cancelled, false, AFTER)).toBeNull();
  });
});
