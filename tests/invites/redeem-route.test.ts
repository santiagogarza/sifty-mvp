import { deriveEntitlement } from "@/lib/entitlements/entitlements";
import { mintInviteCode } from "@/lib/invites/service";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

beforeEach(() => {
  __resetRateLimits();
  vi.stubEnv("INVITE_CODE_PEPPER", "test-pepper-with-enough-length-0123");
});

async function post(body: unknown, cookie?: string, ip = "1.1.1.1") {
  const { POST } = await import("@/app/api/invites/redeem/route");
  return POST(
    new Request("http://localhost/api/invites/redeem", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/invites/redeem", () => {
  it("requires a session", async () => {
    const res = await post({ code: "sifty-x" });
    expect(res.status).toBe(401);
  });

  it("redeems a valid code and the next session sees comped Pro caps", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "r@example.com" });
    const { code } = await mintInviteCode(repos, { durationMonths: 12 });

    const res = await post({ code }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tier).toBe("comped");
    expect(body.compedUntil).toBeTruthy();

    const snap = await repos.entitlements.get(user.id);
    const ent = deriveEntitlement({ profile: user, snapshot: snap });
    expect(ent.tier).toBe("comped");
    expect(ent.caps.connectorsAllowed).toBe(true);
  });

  it("maps failures to statuses and never leaks the hash", async () => {
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "f@example.com" });

    expect((await post({ code: "" }, cookie)).status).toBe(400);
    expect((await post("not json", cookie)).status).toBe(400);
    const malformed = await post({ code: "sifty-abc" }, cookie);
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe("malformed");

    const unknown = await post({ code: `sifty-${"b".repeat(20)}` }, cookie);
    expect(unknown.status).toBe(404);

    const { code, record } = await mintInviteCode(repos);
    await repos.inviteCodes.revoke(record.id);
    const revoked = await post({ code }, cookie);
    expect(revoked.status).toBe(410);
    const text = JSON.stringify(await revoked.json());
    expect(text).not.toContain(record.codeHash);
  });

  it("expired and exhausted codes → 410 with their reason codes", async () => {
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "late@example.com" });
    const other = await createUserWithCookie(repos, { email: "other@example.com" });

    const expired = await mintInviteCode(repos, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res1 = await post({ code: expired.code }, cookie);
    expect(res1.status).toBe(410);
    expect((await res1.json()).code).toBe("expired");

    const single = await mintInviteCode(repos, { maxRedemptions: 1 });
    expect((await post({ code: single.code }, other.cookie, "9.9.9.9")).status).toBe(200);
    const res2 = await post({ code: single.code }, cookie);
    expect(res2.status).toBe(410);
    expect((await res2.json()).code).toBe("exhausted");
  });

  it("second redemption of the same code by the same user → 409", async () => {
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "twice@example.com" });
    const { code } = await mintInviteCode(repos, { maxRedemptions: 5 });
    expect((await post({ code }, cookie)).status).toBe(200);
    const again = await post({ code }, cookie);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("already_redeemed");
  });

  it("rate-limits attempts per user+client with Retry-After", async () => {
    vi.stubEnv("RATELIMIT_REDEEM_PER_MIN", "3");
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "rl@example.com" });
    for (let i = 0; i < 3; i += 1) {
      expect((await post({ code: `sifty-${"c".repeat(20)}` }, cookie)).status).toBe(404);
    }
    const limited = await post({ code: `sifty-${"c".repeat(20)}` }, cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    // A different client id for the same user has its own bucket.
    expect((await post({ code: `sifty-${"c".repeat(20)}` }, cookie, "2.2.2.2")).status).toBe(404);
  });

  it("503 with a clear message when INVITE_CODE_PEPPER is missing", async () => {
    vi.stubEnv("INVITE_CODE_PEPPER", "");
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "nopepper@example.com" });
    const res = await post({ code: `sifty-${"d".repeat(20)}` }, cookie);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/INVITE_CODE_PEPPER/);
  });
});
