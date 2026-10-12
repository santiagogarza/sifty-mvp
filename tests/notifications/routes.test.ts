import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from "@/lib/db/repos/types";
import type { UserProfile } from "@/lib/domain/types";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

const APP = "https://sifty.example";

let seq = 0;
const cookies = new Map<string, string>();

/** A request carrying a real Better Auth session cookie (new user unless `user` is given). */
async function signedInRequest(
  url: string,
  opts: {
    user?: UserProfile;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ req: Request; user: UserProfile }> {
  let user = opts.user;
  if (!user) {
    seq += 1;
    const created = await createUserWithCookie(getTestRepos(), {
      email: `route-${seq}@example.com`,
    });
    user = created.user;
    cookies.set(user.id, created.cookie);
  }
  const cookie = cookies.get(user.id);
  if (!cookie) throw new Error("no cookie for user");
  const headers: Record<string, string> = { cookie, ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { req, user };
}

describe("unsubscribe tokens", () => {
  it("round-trips and rejects tampering", () => {
    const token = createUnsubscribeToken("user_abc");
    expect(verifyUnsubscribeToken(token)).toBe("user_abc");
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken(token.replace(/\.(.)/, ".Z"))).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("nodot")).toBeNull();
    expect(verifyUnsubscribeToken(null)).toBeNull();
    const other = createUnsubscribeToken("user_other");
    expect(verifyUnsubscribeToken(`${token.split(".")[0]}.${other.split(".")[1]}`)).toBeNull();
  });

  it("signs with a dev fallback when the auth secret is unset, except on Vercel production", () => {
    const signed = createUnsubscribeToken("user_abc");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const dev = createUnsubscribeToken("user_abc");
    expect(dev).not.toBe(signed);
    expect(verifyUnsubscribeToken(dev)).toBe("user_abc");
    expect(verifyUnsubscribeToken(signed)).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => createUnsubscribeToken("user_abc")).toThrow(/BETTER_AUTH_SECRET/);
    vi.unstubAllEnvs();
  });
});

describe("/api/notifications/preferences", () => {
  it("401s when signed out", async () => {
    const { GET } = await import("@/app/api/notifications/preferences/route");
    const res = await GET(new Request("http://localhost/api/notifications/preferences"));
    expect(res.status).toBe(401);
  });

  it("returns defaults as unsaved, then persists a valid PUT", async () => {
    const { GET, PUT } = await import("@/app/api/notifications/preferences/route");
    const { req, user } = await signedInRequest("http://localhost/api/notifications/preferences");

    const before = await GET(req);
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.preferences).toMatchObject({ ...DEFAULT_PREFERENCES, saved: false });
    expect(beforeBody.pushConfigured).toBe(false);
    expect(beforeBody.pushSubscriptions).toEqual([]);

    const bad = await PUT(
      await signedInRequest("http://localhost/api/notifications/preferences", {
        user,
        method: "PUT",
        body: { ...DEFAULT_PREFERENCES, timezone: "Nowhere/Land" },
      }).then((r) => r.req),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/timezone/);

    const good = await PUT(
      await signedInRequest("http://localhost/api/notifications/preferences", {
        user,
        method: "PUT",
        body: {
          ...DEFAULT_PREFERENCES,
          timezone: "Europe/Ljubljana",
          morningPlanHour: 6,
          quietHoursStart: 22,
          quietHoursEnd: 7,
        },
      }).then((r) => r.req),
    );
    expect(good.status).toBe(200);
    expect((await good.json()).preferences).toMatchObject({
      saved: true,
      timezone: "Europe/Ljubljana",
      morningPlanHour: 6,
      quietHoursStart: 22,
    });
    const stored = await getTestRepos().notificationPreferences.get(user.id);
    expect(stored?.morningPlanHour).toBe(6);
  });
});

describe("/api/notifications/push/subscribe", () => {
  beforeEach(() => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  const subscription = {
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p256", auth: "auth" },
  };

  it("stores, refreshes, and removes this browser's subscription", async () => {
    const { POST, DELETE } = await import("@/app/api/notifications/push/subscribe/route");
    const { req, user } = await signedInRequest(
      "http://localhost/api/notifications/push/subscribe",
      { method: "POST", body: subscription, headers: { "user-agent": "TestBrowser/1" } },
    );
    const created = await POST(req);
    expect(created.status).toBe(200);

    const again = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          user,
          method: "POST",
          body: { ...subscription, keys: { p256dh: "rotated", auth: "auth2" } },
          headers: { "user-agent": "TestBrowser/1" },
        })
      ).req,
    );
    expect(again.status).toBe(200);
    const subs = await getTestRepos().pushSubscriptions.listForUser(user.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ p256dh: "rotated", userAgent: "TestBrowser/1" });

    const removed = await DELETE(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          user,
          method: "DELETE",
          body: { endpoint: subscription.endpoint },
        })
      ).req,
    );
    expect(await removed.json()).toEqual({ ok: true, removed: true });
    expect(await getTestRepos().pushSubscriptions.listForUser(user.id)).toEqual([]);
  });

  it("rejects malformed and non-https subscriptions", async () => {
    const { POST } = await import("@/app/api/notifications/push/subscribe/route");
    const bad = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          method: "POST",
          body: { endpoint: "http://push.example/abc", keys: subscription.keys },
        })
      ).req,
    );
    expect(bad.status).toBe(400);
    const empty = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          method: "POST",
          body: { endpoint: subscription.endpoint },
        })
      ).req,
    );
    expect(empty.status).toBe(400);
  });

  it("caps devices per account and still accepts a refresh of a known endpoint", async () => {
    const { POST } = await import("@/app/api/notifications/push/subscribe/route");
    const { req, user } = await signedInRequest(
      "http://localhost/api/notifications/push/subscribe",
      { method: "POST", body: subscription },
    );
    expect((await POST(req)).status).toBe(200);
    for (let i = 1; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER; i += 1) {
      await getTestRepos().pushSubscriptions.upsert(user.id, {
        endpoint: `https://push.example/dev${i}`,
        p256dh: "p",
        auth: "a",
        userAgent: null,
      });
    }
    const overflow = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          user,
          method: "POST",
          body: { ...subscription, endpoint: "https://push.example/one-too-many" },
        })
      ).req,
    );
    expect(overflow.status).toBe(409);
    const refresh = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          user,
          method: "POST",
          body: subscription,
        })
      ).req,
    );
    expect(refresh.status).toBe(200);
    expect(await getTestRepos().pushSubscriptions.listForUser(user.id)).toHaveLength(
      MAX_PUSH_SUBSCRIPTIONS_PER_USER,
    );
  });

  it("503s with a clear message when push is not configured", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const { POST } = await import("@/app/api/notifications/push/subscribe/route");
    const res = await POST(
      (
        await signedInRequest("http://localhost/api/notifications/push/subscribe", {
          method: "POST",
          body: subscription,
        })
      ).req,
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/);
  });
});

describe("/api/notifications/unsubscribe", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", APP));
  afterEach(() => vi.unstubAllEnvs());

  it("GET only confirms; the form POST turns email off and redirects; one-click POST is JSON", async () => {
    const { GET, POST } = await import("@/app/api/notifications/unsubscribe/route");
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "u@example.com",
      displayName: "U",
      isCreator: false,
    });
    const token = createUnsubscribeToken(user.id);
    const url = `http://localhost/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;

    // A link scanner's GET changes nothing.
    const page = await GET(new Request(url));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('name="confirm"');
    expect(html).toContain(`action="${APP}/api/notifications/unsubscribe?token=`);
    expect(await repos.notificationPreferences.get(user.id)).toBeNull();

    const res = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "confirm=1",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${APP}/settings/notifications?unsubscribed=1`);
    expect((await repos.notificationPreferences.get(user.id))?.emailEnabled).toBe(false);

    // RFC 8058 one-click on an already-unsubscribed user is fine and idempotent.
    const post = await POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(await post.json()).toEqual({ ok: true, unsubscribed: false });
  });

  it("rejects bad tokens without touching anything", async () => {
    const { GET, POST } = await import("@/app/api/notifications/unsubscribe/route");
    const res = await GET(new Request("http://localhost/api/notifications/unsubscribe?token=nope"));
    expect(res.headers.get("location")).toBe(`${APP}/settings/notifications?unsubscribed=invalid`);
    const post = await POST(
      new Request("http://localhost/api/notifications/unsubscribe", { method: "POST" }),
    );
    expect(post.status).toBe(400);
  });
});

describe("GET /api/cron/send-digests", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-secret-test"));
  afterEach(() => vi.unstubAllEnvs());

  async function get(authorization?: string) {
    const { GET } = await import("@/app/api/cron/send-digests/route");
    return GET(
      new Request("http://localhost/api/cron/send-digests", {
        headers: authorization ? { authorization } : {},
      }),
    );
  }

  it("503s without CRON_SECRET and 401s without the bearer", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer anything")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret-test");
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
  });

  it("runs the digest cycle and reports counts", async () => {
    const res = await get("Bearer cron-secret-test");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      users: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      truncated: false,
    });
  });
});
