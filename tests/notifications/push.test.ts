import type { PushSubscriptionRecord } from "@/lib/db/repos/types";
import { findProductionEnvProblems } from "@/lib/env/production-guards";
import {
  PushMisconfiguredError,
  type PushTransport,
  getPushConfig,
  inspectPushEnv,
  isPushConfigured,
  resetPushConfigReportForTesting,
  sendPushToUser,
  setPushTransportForTesting,
} from "@/lib/notifications/push";
import { setErrorSink } from "@/lib/observability/report-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const payload = { title: "Hi", body: "there", url: "https://sifty.example/today", tag: "t" };

async function userWithSubscriptions(endpoints: string[]) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: "push@example.com",
    displayName: "Push",
    isCreator: false,
  });
  for (const endpoint of endpoints) {
    await repos.pushSubscriptions.upsert(user.id, {
      endpoint,
      p256dh: "p",
      auth: "a",
      userAgent: null,
    });
  }
  return user;
}

describe("push config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a no-op when no VAPID variable is set", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(getPushConfig()).toBeNull();
    expect(isPushConfigured()).toBe(false);

    const user = await userWithSubscriptions(["https://push.example/1"]);
    const sent: string[] = [];
    setPushTransportForTesting(async (sub) => {
      sent.push(sub.endpoint);
      return "delivered";
    });
    expect(await sendPushToUser(getTestRepos(), user.id, payload)).toEqual({
      status: "not_configured",
    });
    expect(sent).toEqual([]);
    setPushTransportForTesting(null);
  });

  it("treats a partial setup as push off, reports it once, and blocks a production boot", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const partial = inspectPushEnv();
    expect(partial).toBeInstanceOf(PushMisconfiguredError);
    expect((partial as Error).message).toMatch(/VAPID_PRIVATE_KEY, VAPID_SUBJECT missing/);

    const reported: unknown[] = [];
    setErrorSink((err) => {
      reported.push(err);
    });
    resetPushConfigReportForTesting();
    expect(getPushConfig()).toBeNull();
    expect(isPushConfigured()).toBe(false);
    expect(getPushConfig()).toBeNull();
    expect(reported).toHaveLength(1);
    setErrorSink(() => undefined);

    const problems = findProductionEnvProblems({
      VERCEL_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(32),
      DATABASE_URL: "postgres://x",
      VAPID_PUBLIC_KEY: "pub",
    });
    expect(problems.blocking.some((p) => /Web Push is partially configured/.test(p))).toBe(true);
    expect(
      findProductionEnvProblems({
        VERCEL_ENV: "production",
        BETTER_AUTH_SECRET: "x".repeat(32),
        DATABASE_URL: "postgres://x",
      }).blocking,
    ).toEqual([]);
  });

  it("rejects a subject that is neither mailto: nor https:", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "santi@example.com");
    expect((inspectPushEnv() as Error).message).toMatch(/mailto:/);
    resetPushConfigReportForTesting();
    setErrorSink(() => undefined);
    expect(getPushConfig()).toBeNull();
    vi.stubEnv("VAPID_SUBJECT", "mailto:santi@example.com");
    expect(getPushConfig()).toEqual({
      publicKey: "pub",
      privateKey: "priv",
      subject: "mailto:santi@example.com",
    });
  });
});

describe("sendPushToUser", () => {
  const calls: Array<{ sub: PushSubscriptionRecord; body: string }> = [];
  const reported: unknown[] = [];

  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:santi@example.com");
    calls.length = 0;
    reported.length = 0;
    setErrorSink((err) => {
      reported.push(err);
    });
  });

  afterEach(() => {
    setPushTransportForTesting(null);
    setErrorSink(() => undefined);
    vi.unstubAllEnvs();
  });

  it("fans out to every device and records the delivery time", async () => {
    const user = await userWithSubscriptions(["https://push.example/1", "https://push.example/2"]);
    const transport: PushTransport = async (sub, p) => {
      calls.push({ sub, body: JSON.stringify(p) });
      return "delivered";
    };
    setPushTransportForTesting(transport);
    const now = new Date("2026-10-12T05:00:00Z");
    expect(await sendPushToUser(getTestRepos(), user.id, payload, now)).toEqual({
      status: "sent",
      delivered: 2,
      removed: 0,
      failed: 0,
    });
    expect(calls.map((c) => c.sub.endpoint)).toEqual([
      "https://push.example/1",
      "https://push.example/2",
    ]);
    const subs = await getTestRepos().pushSubscriptions.listForUser(user.id);
    expect(subs.map((s) => s.lastUsedAt)).toEqual([now.toISOString(), now.toISOString()]);
  });

  it("drops endpoints the push service reports gone and keeps going after a failure", async () => {
    const user = await userWithSubscriptions([
      "https://push.example/gone",
      "https://push.example/broken",
      "https://push.example/ok",
    ]);
    setPushTransportForTesting(async (sub) => {
      if (sub.endpoint.endsWith("gone")) return "gone";
      if (sub.endpoint.endsWith("broken")) throw new Error("boom");
      return "delivered";
    });
    expect(await sendPushToUser(getTestRepos(), user.id, payload)).toEqual({
      status: "sent",
      delivered: 1,
      removed: 1,
      failed: 1,
    });
    const left = await getTestRepos().pushSubscriptions.listForUser(user.id);
    expect(left.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/broken",
      "https://push.example/ok",
    ]);
    expect(reported).toHaveLength(1);
  });

  it("reports no_subscriptions for a user without devices", async () => {
    const user = await userWithSubscriptions([]);
    setPushTransportForTesting(async () => "delivered");
    expect(await sendPushToUser(getTestRepos(), user.id, payload)).toEqual({
      status: "no_subscriptions",
    });
  });
});
