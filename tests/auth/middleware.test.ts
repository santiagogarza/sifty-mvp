import { signSessionToken } from "@/lib/auth/jwt";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-auth-secret-do-not-use-in-production-please-32");
  vi.stubEnv("SIFTY_DISABLE_AUTH", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware", () => {
  it("redirects unauthenticated users away from protected routes", async () => {
    const req = new NextRequest("http://localhost/today");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("next=%2Ftoday");
  });

  it("gates the board route", async () => {
    const req = new NextRequest("http://localhost/board");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("next=%2Fboard");
  });

  it("redirects when the JWT cookie is invalid", async () => {
    const req = new NextRequest("http://localhost/today", {
      headers: { cookie: "sifty_session=not-a-real-jwt" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });

  it("allows authenticated users through", async () => {
    const token = await signSessionToken({ sub: "u1", sid: "s1", email: "u@example.com" }, 60);
    const req = new NextRequest("http://localhost/today", {
      headers: { cookie: `sifty_session=${token}` },
    });
    const res = await middleware(req);
    // No redirect; NextResponse.next() returns 200 in middleware tests.
    expect(res.status).toBe(200);
  });

  it("does not gate non-protected paths", async () => {
    const req = new NextRequest("http://localhost/sign-in");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("SIFTY_DISABLE_AUTH=1 short-circuits the gate", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    const req = new NextRequest("http://localhost/today");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
