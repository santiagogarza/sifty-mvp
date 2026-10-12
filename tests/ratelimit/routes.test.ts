import { resolveProvider } from "@/lib/ai/provider";
import { RATE_LIMIT_MESSAGE } from "@/lib/auth/abuse-hooks";
import {
  __resetRateLimits,
  createMemoryStore,
  createUpstashStore,
  setRateLimitStoreForTesting,
} from "@/lib/ratelimit/limiter";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";
import { createUserWithCookie } from "../helpers/auth";
import { FakeUpstashRedis } from "../helpers/fake-upstash-redis";
import { getTestRepos } from "../setup";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const T0 = Date.UTC(2026, 0, 1, 12, 0, 10);

/**
 * Every route is exercised against both stores so the limits mean the same
 * thing with and without Redis.
 */
const STORES = [
  { name: "in-process", make: () => createMemoryStore() },
  {
    name: "upstash (fake Redis)",
    make: () => createUpstashStore(new FakeUpstashRedis().asRedis()),
  },
];

function json(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function expect429(res: Response) {
  expect(res.status).toBe(429);
  expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  const body = await res.json();
  expect(body.code).toBe("rate_limited");
  // Both shapes carry a human sentence: `message` is what the Better Auth
  // client renders, `error` what the app's fetch helpers read.
  expect(typeof body.message).toBe("string");
  expect(body.message.length).toBeGreaterThan(0);
  return body as { code: string; message: string; error?: string };
}

describe.each(STORES)("per-route rate limits — $name", ({ make }) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    __resetRateLimits();
    setRateLimitStoreForTesting(make());
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly_test");
    vi.stubEnv("INVITE_CODE_PEPPER", "test-pepper-with-enough-length-0123");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-do-not-use-in-production-please-32");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("triage"));
  });

  afterEach(() => {
    __resetRateLimits();
    vi.useRealTimers();
  });

  it("/api/triage: per-IP cap spans users; per-user cap spans IPs", async () => {
    vi.stubEnv("RATELIMIT_TRIAGE_IP_PER_MIN", "3");
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "2");
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "a@example.com", isCreator: false });
    const b = await createUserWithCookie(repos, { email: "b@example.com", isCreator: false });
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        title: "T",
        description: null,
        nextAction: null,
        urgency: 0.4,
        importance: 0.4,
        effort: "small",
        dueHint: null,
        delegationCandidate: "self",
        suggestedLabels: [],
        subtasks: [],
        rationale: null,
        confidence: 0.7,
        clarifyingQuestion: null,
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);
    const { POST } = await import("@/app/api/triage/route");
    const fire = (cookie: string, ip: string) =>
      POST(
        json(
          "http://localhost/api/triage",
          { sourceText: "Test" },
          { cookie, "x-forwarded-for": ip },
        ),
      );

    // Same IP, two users: the third request from that IP is refused even
    // though each user is under their own cap.
    expect((await fire(a.cookie, "9.9.9.9")).status).toBe(200);
    expect((await fire(b.cookie, "9.9.9.9")).status).toBe(200);
    expect((await fire(a.cookie, "9.9.9.9")).status).toBe(200);
    await expect429(await fire(b.cookie, "9.9.9.9"));

    // Same user from fresh IPs: already used 2 of 2 → refused regardless of IP.
    await expect429(await fire(a.cookie, "7.7.7.7"));
    // The other user had 1 of 2 → one more from a fresh IP passes.
    expect((await fire(b.cookie, "8.8.8.8")).status).toBe(200);
  });

  it("/api/agent-brief: own per-user budget, 429 before any task lookup", async () => {
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "2");
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "brief@example.com" });
    const { POST } = await import("@/app/api/agent-brief/route");
    const fire = () =>
      POST(
        json(
          "http://localhost/api/agent-brief",
          { taskId: "task_missing" },
          { cookie, "x-forwarded-for": "9.9.9.9" },
        ),
      );
    expect((await fire()).status).toBe(404);
    expect((await fire()).status).toBe(404);
    await expect429(await fire());
  });

  it("/api/invites/redeem: per IP across users and per user across IPs", async () => {
    vi.stubEnv("RATELIMIT_REDEEM_IP_PER_MIN", "3");
    vi.stubEnv("RATELIMIT_REDEEM_PER_MIN", "2");
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "ra@example.com" });
    const b = await createUserWithCookie(repos, { email: "rb@example.com" });
    const { POST } = await import("@/app/api/invites/redeem/route");
    const fire = (cookie: string, ip: string) =>
      POST(
        json(
          "http://localhost/api/invites/redeem",
          { code: `sifty-${"b".repeat(20)}` },
          { cookie, "x-forwarded-for": ip },
        ),
      );

    expect((await fire(a.cookie, "1.1.1.1")).status).toBe(404);
    expect((await fire(b.cookie, "1.1.1.1")).status).toBe(404);
    expect((await fire(a.cookie, "1.1.1.1")).status).toBe(404);
    await expect429(await fire(b.cookie, "1.1.1.1"));
    await expect429(await fire(a.cookie, "2.2.2.2"));
    expect((await fire(b.cookie, "3.3.3.3")).status).toBe(404);
  });

  it("/api/stripe/checkout and /api/stripe/portal share one per-user budget and a per-IP one", async () => {
    vi.stubEnv("RATELIMIT_STRIPE_USER_PER_MIN", "2");
    vi.stubEnv("RATELIMIT_STRIPE_IP_PER_MIN", "3");
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "sa@example.com" });
    const b = await createUserWithCookie(repos, { email: "sb@example.com" });
    const checkout = (await import("@/app/api/stripe/checkout/route")).POST;
    const portal = (await import("@/app/api/stripe/portal/route")).POST;
    const headers = (cookie: string, ip: string) => ({ cookie, "x-forwarded-for": ip });

    // Portal 400s (no Stripe customer) but still consumes a token.
    expect(
      (await portal(json("http://localhost/api/stripe/portal", {}, headers(a.cookie, "5.5.5.5"))))
        .status,
    ).toBe(400);
    expect(
      (await portal(json("http://localhost/api/stripe/portal", {}, headers(a.cookie, "5.5.5.5"))))
        .status,
    ).toBe(400);
    // Third for user a (from a new IP): per-user cap.
    await expect429(
      await checkout(
        json(
          "http://localhost/api/stripe/checkout",
          { cadence: "monthly" },
          headers(a.cookie, "6.6.6.6"),
        ),
      ),
    );
    // IP 5.5.5.5 has used 2 of 3; user b gets one, then the IP cap bites.
    expect(
      (await portal(json("http://localhost/api/stripe/portal", {}, headers(b.cookie, "5.5.5.5"))))
        .status,
    ).toBe(400);
    await expect429(
      await portal(json("http://localhost/api/stripe/portal", {}, headers(b.cookie, "5.5.5.5"))),
    );
  });

  it("unauthenticated floods spend the IP budget before any session lookup", async () => {
    vi.stubEnv("RATELIMIT_STRIPE_IP_PER_MIN", "2");
    vi.stubEnv("RATELIMIT_REDEEM_IP_PER_MIN", "2");
    vi.stubEnv("RATELIMIT_TRIAGE_IP_PER_MIN", "2");
    const checkout = (await import("@/app/api/stripe/checkout/route")).POST;
    const redeem = (await import("@/app/api/invites/redeem/route")).POST;
    const triage = (await import("@/app/api/triage/route")).POST;
    const brief = (await import("@/app/api/agent-brief/route")).POST;
    const anon = { "x-forwarded-for": "66.66.66.66", cookie: "sifty.session_token=forged" };

    const flood = async (fire: () => Promise<Response>) => {
      expect((await fire()).status).toBe(401);
      expect((await fire()).status).toBe(401);
      await expect429(await fire());
    };
    await flood(() => checkout(json("http://localhost/api/stripe/checkout", {}, anon)));
    await flood(() =>
      redeem(json("http://localhost/api/invites/redeem", { code: "sifty-x" }, anon)),
    );
    await flood(() => triage(json("http://localhost/api/triage", { sourceText: "x" }, anon)));
    await flood(() => brief(json("http://localhost/api/agent-brief", { taskId: "t" }, anon)));
  });

  it("/api/stripe/webhook: per-IP cap on forged requests", async () => {
    vi.stubEnv("RATELIMIT_STRIPE_WEBHOOK_PER_MIN", "2");
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const fire = () =>
      POST(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "x-forwarded-for": "4.4.4.4" },
          body: "{}",
        }),
      );
    expect((await fire()).status).toBe(400);
    expect((await fire()).status).toBe(400);
    await expect429(await fire());
  });

  it("/api/auth/sign-in/email and sign-up/email: per-email cap regardless of IP", async () => {
    vi.stubEnv("RATELIMIT_AUTH_EMAIL_PER_MIN", "3");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const origin = { origin: "http://localhost:3000" };
    const attempt = (ip: string, email = "Victim@Example.com") =>
      POST(
        json(
          "http://localhost/api/auth/sign-in/email",
          { email, password: "wrong-password" },
          { "x-forwarded-for": ip, ...origin },
        ),
      );

    expect((await attempt("1.1.1.1")).status).toBe(401);
    expect((await attempt("2.2.2.2")).status).toBe(401);
    // Email is normalised: a sign-up attempt for the same mailbox counts too.
    expect(
      (
        await POST(
          json(
            "http://localhost/api/auth/sign-up/email",
            { email: "victim@example.com", password: "password-123", name: "V" },
            { "x-forwarded-for": "3.3.3.3", ...origin },
          ),
        )
      ).status,
    ).toBe(200);
    const limited = await expect429(await attempt("4.4.4.4"));
    expect(limited.message).toBe(RATE_LIMIT_MESSAGE);
    // Another account is unaffected.
    expect((await attempt("4.4.4.4", "other@example.com")).status).toBe(401);
  });

  it("send-verification-email draws from the same per-email cap", async () => {
    vi.stubEnv("RATELIMIT_AUTH_EMAIL_PER_MIN", "2");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const resend = () =>
      POST(
        json(
          "http://localhost/api/auth/send-verification-email",
          { email: "resend@example.com", callbackURL: "/today" },
          { origin: "http://localhost:3000" },
        ),
      );
    expect((await resend()).status).toBe(200);
    expect((await resend()).status).toBe(200);
    await expect429(await resend());
  });

  it("magic-link and password-reset requests share the per-email cap", async () => {
    vi.stubEnv("RATELIMIT_AUTH_EMAIL_PER_MIN", "2");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const origin = { origin: "http://localhost:3000" };
    const magic = () =>
      POST(
        json(
          "http://localhost/api/auth/sign-in/magic-link",
          { email: "flood@example.com", callbackURL: "/today" },
          origin,
        ),
      );
    expect((await magic()).status).toBe(200);
    expect(
      (
        await POST(
          json(
            "http://localhost/api/auth/request-password-reset",
            { email: "flood@example.com", redirectTo: "/reset-password" },
            origin,
          ),
        )
      ).status,
    ).toBe(200);
    await expect429(await magic());
  });

  it("middleware: POST /api/auth/* is capped per IP; GET is not", async () => {
    vi.stubEnv("RATELIMIT_AUTH_IP_PER_MIN", "2");
    const post = (path: string, ip: string) =>
      middleware(
        new NextRequest(`http://localhost${path}`, {
          method: "POST",
          headers: { "x-forwarded-for": ip },
        }),
      );

    expect((await post("/api/auth/sign-in", "1.2.3.4")).status).toBe(200);
    expect((await post("/api/auth/sign-up", "1.2.3.4")).status).toBe(200);
    const limited = await post("/api/auth/magic-link", "1.2.3.4");
    const body = await expect429(limited);
    // The sign-in form renders `message` (via `authErrorMessage`), so the
    // middleware 429 must say the same thing as the per-email hook's 429.
    expect(body.message).toBe(RATE_LIMIT_MESSAGE);
    expect(body.error).toBe(RATE_LIMIT_MESSAGE);
    // Other IPs and reads are unaffected.
    expect((await post("/api/auth/sign-in", "5.6.7.8")).status).toBe(200);
    const read = await middleware(
      new NextRequest("http://localhost/api/auth/me", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      }),
    );
    expect(read.status).toBe(200);
  });

  it("middleware: the auth limit applies even with SIFTY_DISABLE_AUTH=1", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    vi.stubEnv("RATELIMIT_AUTH_IP_PER_MIN", "1");
    const post = () =>
      middleware(
        new NextRequest("http://localhost/api/auth/sign-in", {
          method: "POST",
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
      );
    expect((await post()).status).toBe(200);
    await expect429(await post());
  });
});
