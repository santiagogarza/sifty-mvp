import {
  BOTID_PROTECTED_ROUTES,
  BOTID_TIMEOUT_MS,
  isBotIdActive,
  setBotVerdictForTesting,
  verifyNotBot,
} from "@/lib/abuse/botid";
import { reportError } from "@/lib/observability/report-error";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { checkBotId } from "botid/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

vi.mock("botid/server", () => ({ checkBotId: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));

beforeEach(() => {
  __resetRateLimits();
  setBotVerdictForTesting(null);
  vi.mocked(checkBotId).mockReset();
  vi.mocked(reportError).mockReset();
  vi.stubEnv("INVITE_CODE_PEPPER", "test-pepper-with-enough-length-0123");
});

afterEach(() => {
  setBotVerdictForTesting(null);
});

function post(url: string, body: unknown, cookie?: string) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("verifyNotBot", () => {
  it("is a no-op outside Vercel deployments and never calls the SDK", async () => {
    vi.stubEnv("VERCEL", "");
    expect(isBotIdActive()).toBe(false);
    expect(await verifyNotBot("test")).toEqual({ isBot: false, source: "inactive" });
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("calls checkBotId on Vercel and relays the verdict", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(checkBotId).mockResolvedValue({
      isBot: true,
      isHuman: false,
      isVerifiedBot: false,
      bypassed: false,
    });
    expect(isBotIdActive()).toBe(true);
    expect(await verifyNotBot("test")).toEqual({ isBot: true, source: "botid" });
  });

  it("SIFTY_DISABLE_BOTID=1 turns it off on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SIFTY_DISABLE_BOTID", "1");
    expect(await verifyNotBot("test")).toEqual({ isBot: false, source: "inactive" });
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("fails open and reports when the classifier throws", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(checkBotId).mockRejectedValue(new Error("x-vercel-oidc-token missing"));
    expect(await verifyNotBot("auth.sign-up")).toEqual({ isBot: false, source: "error" });
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { area: "botid.auth.sign-up" });
  });

  it("abandons a hung classifier at the deadline, fails open, and reports", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.useFakeTimers();
    try {
      vi.mocked(checkBotId).mockReturnValue(new Promise(() => {}));
      const pending = verifyNotBot("auth.sign-up");
      await vi.advanceTimersByTimeAsync(BOTID_TIMEOUT_MS + 1);
      expect(await pending).toEqual({ isBot: false, source: "timeout" });
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), { area: "botid.auth.sign-up" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("protects sign-up (both auth layers) and invite redemption on the client", () => {
    expect(BOTID_PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/auth/sign-up",
      "POST /api/auth/sign-up/email",
      "POST /api/invites/redeem",
    ]);
  });
});

describe("routes behind BotID", () => {
  it("POST /api/auth/sign-up/email refuses a bot verdict and creates no account", async () => {
    setBotVerdictForTesting({ isBot: true, source: "test" });
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const signUp = (email: string) =>
      POST(
        new Request("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email, password: "password-123", name: "X" }),
        }),
      );
    const res = await signUp("bot@example.com");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bot_detected");
    expect(await getTestRepos().users.getByEmail("bot@example.com")).toBeNull();

    setBotVerdictForTesting({ isBot: false, source: "test" });
    expect((await signUp("human@example.com")).status).toBe(200);
  });

  it("POST /api/invites/redeem refuses a bot verdict after the session check", async () => {
    // Sign up before forcing the verdict: sign-up itself is bot-checked.
    const { cookie } = await createUserWithCookie(getTestRepos(), { email: "r@example.com" });
    setBotVerdictForTesting({ isBot: true, source: "test" });
    const { POST } = await import("@/app/api/invites/redeem/route");
    const anonymous = await POST(post("http://localhost/api/invites/redeem", { code: "sifty-x" }));
    expect(anonymous.status).toBe(401);

    const res = await POST(
      post("http://localhost/api/invites/redeem", { code: "sifty-x" }, cookie),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("bot_detected");
  });
});
