import { setEmailProviderForTesting } from "@/lib/email";
import { GRACE_PERIOD_DAYS, emptySnapshot } from "@/lib/entitlements/entitlements";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestOutbox, getTestRepos } from "../setup";

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
  created?: Date;
  object?: Record<string, unknown>;
}

function makeEvent(opts: MakeEventOptions): { id: string; body: string } {
  const id = opts.id ?? `evt_${Math.random().toString(36).slice(2, 12)}`;
  const obj =
    opts.object ??
    (opts.type === "invoice.payment_failed" || opts.type === "invoice.paid"
      ? {
          customer: opts.customer ?? "cus_X",
          subscription: opts.subscriptionId ?? "sub_X",
          status: opts.status ?? "paid",
          amount_due: 1000,
          currency: "usd",
        }
      : {
          id: opts.subscriptionId ?? "sub_X",
          status: opts.status ?? "active",
          current_period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          customer: opts.customer ?? "cus_X",
        });
  const body = JSON.stringify({
    id,
    object: "event",
    type: opts.type,
    created: Math.floor((opts.created ?? new Date()).getTime() / 1000),
    data: { object: obj },
  });
  return { id, body };
}

async function deliver(body: string, secret = WEBHOOK_SECRET) {
  const POST = await importRoute();
  return POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signed(body, secret) },
      body,
    }),
  );
}

async function payingUser(email: string, customer: string, subscription: string) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email,
    passwordHash: null,
    displayName: email.split("@")[0]!,
    isCreator: false,
  });
  await repos.entitlements.upsert(user.id, {
    ...emptySnapshot(),
    tier: "pro",
    subscriptionActive: true,
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription,
    stripeStatus: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await repos.users.setStripeCustomerId(user.id, customer);
  return user;
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

  it("rejects a signature made with another secret, and a stale timestamp", async () => {
    const POST = await importRoute();
    const { body } = makeEvent({ type: "customer.subscription.created" });
    const wrongSecret = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signed(body, "whsec_someone_elses_secret_0000000000") },
        body,
      }),
    );
    expect(wrongSecret.status).toBe(400);

    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const stale = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signed(body, WEBHOOK_SECRET, tenMinutesAgo) },
        body,
      }),
    );
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toMatch(/invalid signature/i);
  });

  it("503s (not 500) when the webhook secret is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { body } = makeEvent({ type: "customer.subscription.created" });
    const res = await deliver(body);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });

  it("acknowledges unhandled event types without touching state", async () => {
    const { body } = makeEvent({
      type: "customer.created",
      object: { id: "cus_new", object: "customer" },
    });
    const res = await deliver(body);
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe(true);
  });

  it("500s and forgets the dedupe record when the customer is unknown, so Stripe retries", async () => {
    const repos = getTestRepos();
    const { id, body } = makeEvent({
      type: "customer.subscription.created",
      customer: "cus_ghost",
    });
    const res = await deliver(body);
    expect(res.status).toBe(500);
    expect(await repos.stripeEvents.recordIfNew(id, "customer.subscription.created")).toBe(true);
  });

  it("activates entitlement on subscription.created and is idempotent on replay", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u@example.com",
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
    expect(after?.tier).toBe("pro");
    expect(after?.subscriptionActive).toBe(true);

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
    expect(final?.tier).toBe("pro");
    expect(final?.stripeSubscriptionId).toBe("sub_X");
    void id;
  });

  it("subscription.deleted drops a paying user to free", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u2@example.com",
      displayName: "U2",
      isCreator: false,
    });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      tier: "pro",
      subscriptionActive: true,
      stripeCustomerId: "cus_Y",
      stripeSubscriptionId: "sub_Y",
      stripeStatus: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
    expect(after?.tier).toBe("free");
    expect(after?.subscriptionActive).toBe(false);
  });

  it("reads through the locked update() so a concurrent comp is kept", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u3@example.com",
      displayName: "U3",
      isCreator: false,
    });
    await repos.entitlements.upsert(user.id, {
      ...emptySnapshot(),
      tier: "pro",
      subscriptionActive: true,
      stripeCustomerId: "cus_Z",
      stripeSubscriptionId: "sub_Z",
      stripeStatus: "active",
    });
    await repos.users.setStripeCustomerId(user.id, "cus_Z");
    // A redemption lands between the webhook's arrival and its write; the
    // mutator must see it because update() reads inside the lock.
    const original = repos.entitlements.update.bind(repos.entitlements);
    const spy = vi.spyOn(repos.entitlements, "update").mockImplementation(async (id, mutate) => {
      const ent = (await repos.entitlements.get(id))!;
      await repos.entitlements.upsert(id, {
        ...ent,
        tier: "comped",
        compedAt: new Date().toISOString(),
        compedUntil: null,
      });
      return original(id, mutate);
    });

    const POST = await importRoute();
    const { body } = makeEvent({
      type: "customer.subscription.deleted",
      customer: "cus_Z",
      subscriptionId: "sub_Z",
      status: "canceled",
    });
    const res = await POST(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signed(body, WEBHOOK_SECRET) },
        body,
      }),
    );
    expect(res.status).toBe(200);
    spy.mockRestore();

    const after = await repos.entitlements.get(user.id);
    expect(after?.subscriptionActive).toBe(false);
    expect(after?.compedAt).toBeTruthy();
    expect(after?.tier).toBe("comped");
  });

  describe("dunning", () => {
    it("invoice.payment_failed opens grace, keeps Pro, and emails the user once per event", async () => {
      const repos = getTestRepos();
      const user = await payingUser("dun@example.com", "cus_D", "sub_D");
      const failedAt = new Date("2026-10-12T12:00:00.000Z");
      const { body } = makeEvent({
        type: "invoice.payment_failed",
        customer: "cus_D",
        subscriptionId: "sub_D",
        created: failedAt,
      });

      const res = await deliver(body);
      expect(res.status).toBe(200);

      const after = await repos.entitlements.get(user.id);
      expect(after?.subscriptionActive).toBe(false);
      expect(after?.stripeStatus).toBe("past_due");
      expect(after?.graceEndsAt).toBe(
        new Date(failedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      );
      expect(after?.tier).toBe("pro");

      const outbox = getTestOutbox().outbox;
      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.to).toBe("dun@example.com");
      expect(outbox[0]!.subject).toMatch(/payment didn't go through/i);
      expect(outbox[0]!.text).toContain("$10.00");
      expect(outbox[0]!.text).toContain("October 19");
      expect(outbox[0]!.text).toContain("/settings/billing");
      expect(outbox[0]!.idempotencyKey).toMatch(/^payment-failed:evt_/);

      // Replay of the same event: deduped, no second email.
      const replay = await deliver(body);
      expect((await replay.json()).deduped).toBe(true);
      expect(getTestOutbox().outbox).toHaveLength(1);
    });

    it("a retry that fails later sends another email but keeps the original grace end", async () => {
      const repos = getTestRepos();
      const user = await payingUser("retry@example.com", "cus_R", "sub_R");
      const first = new Date("2026-10-12T12:00:00.000Z");
      await deliver(
        makeEvent({ type: "invoice.payment_failed", customer: "cus_R", created: first }).body,
      );
      const graceEnd = (await repos.entitlements.get(user.id))?.graceEndsAt;
      await deliver(
        makeEvent({
          type: "invoice.payment_failed",
          customer: "cus_R",
          created: new Date(first.getTime() + 3 * 24 * 60 * 60 * 1000),
        }).body,
      );
      expect((await repos.entitlements.get(user.id))?.graceEndsAt).toBe(graceEnd);
      expect(getTestOutbox().outbox).toHaveLength(2);
    });

    it("still 200s and records the entitlement when the dunning email cannot be sent", async () => {
      const repos = getTestRepos();
      const user = await payingUser("mailfail@example.com", "cus_M", "sub_M");
      setEmailProviderForTesting({
        name: "console",
        async send() {
          throw new Error("smtp down");
        },
      });
      const { id, body } = makeEvent({ type: "invoice.payment_failed", customer: "cus_M" });
      const res = await deliver(body);
      expect(res.status).toBe(200);
      expect((await repos.entitlements.get(user.id))?.stripeStatus).toBe("past_due");
      // Dedupe record kept: Stripe must not replay against a known mail outage.
      expect(await repos.stripeEvents.recordIfNew(id, "invoice.payment_failed")).toBe(false);
    });

    it("recovery: subscription.updated(active) clears grace and sends no mail", async () => {
      const repos = getTestRepos();
      const user = await payingUser("recover@example.com", "cus_V", "sub_V");
      await deliver(makeEvent({ type: "invoice.payment_failed", customer: "cus_V" }).body);
      await deliver(
        makeEvent({
          type: "customer.subscription.updated",
          customer: "cus_V",
          subscriptionId: "sub_V",
          status: "active",
        }).body,
      );
      const after = await repos.entitlements.get(user.id);
      expect(after?.subscriptionActive).toBe(true);
      expect(after?.graceEndsAt).toBeNull();
      expect(after?.tier).toBe("pro");
      expect(getTestOutbox().outbox).toHaveLength(1);
    });

    it("never emails the creator", async () => {
      const repos = getTestRepos();
      const creator = await repos.users.create({
        email: process.env.CREATOR_EMAIL!,
        passwordHash: null,
        displayName: "Santi",
        isCreator: true,
      });
      await repos.entitlements.upsert(creator.id, {
        ...emptySnapshot(),
        tier: "creator",
        stripeCustomerId: "cus_C",
      });
      const res = await deliver(
        makeEvent({ type: "invoice.payment_failed", customer: "cus_C" }).body,
      );
      expect(res.status).toBe(200);
      expect((await repos.entitlements.get(creator.id))?.tier).toBe("creator");
      expect(getTestOutbox().outbox).toHaveLength(0);
    });
  });

  describe("checkout.session.completed", () => {
    it("links the Stripe customer to the user named by client_reference_id", async () => {
      const repos = getTestRepos();
      const user = await repos.users.create({
        email: "link@example.com",
        passwordHash: null,
        displayName: "Link",
        isCreator: false,
      });
      await repos.entitlements.startTrialIfMissing(user.id, 30);
      const { body } = makeEvent({
        type: "checkout.session.completed",
        object: {
          id: "cs_1",
          customer: "cus_L",
          client_reference_id: user.id,
          mode: "subscription",
        },
      });
      expect((await deliver(body)).status).toBe(200);
      expect((await repos.entitlements.get(user.id))?.stripeCustomerId).toBe("cus_L");
      expect((await repos.users.findByStripeCustomerId("cus_L"))?.id).toBe(user.id);

      // The subscription event that follows now finds its owner.
      await deliver(
        makeEvent({ type: "customer.subscription.created", customer: "cus_L", status: "active" })
          .body,
      );
      expect((await repos.entitlements.get(user.id))?.tier).toBe("pro");
    });

    it("ignores sessions without a known user instead of failing", async () => {
      const { body } = makeEvent({
        type: "checkout.session.completed",
        object: { id: "cs_2", customer: "cus_nobody", client_reference_id: "user_missing" },
      });
      expect((await deliver(body)).status).toBe(200);
    });
  });
});
