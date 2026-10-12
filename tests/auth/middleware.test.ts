import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("SIFTY_DISABLE_AUTH", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware", () => {
  it("redirects visitors without a session cookie away from protected routes", async () => {
    const req = new NextRequest("http://localhost/today");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/sign-in");
    expect(location).toContain("next=%2Ftoday");
  });

  it("ignores cookies that are not the Sifty session cookie", async () => {
    const req = new NextRequest("http://localhost/today", {
      headers: { cookie: "better-auth.session_token=abc; sifty_session=legacy-jwt" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });

  it("lets requests with a session cookie through to the server-side check", async () => {
    const req = new NextRequest("http://localhost/today", {
      headers: { cookie: "sifty.session_token=tok.sig" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-sifty-path")).toBe("/today");
  });

  it("forwards the query string so a stale session can return to /redeem?code=…", async () => {
    const req = new NextRequest("http://localhost/redeem?code=sifty-abc", {
      headers: { cookie: "sifty.session_token=tok.sig" },
    });
    const res = await middleware(req);
    expect(res.headers.get("x-middleware-request-x-sifty-path")).toBe("/redeem?code=sifty-abc");
  });

  it("accepts the __Secure- prefixed cookie used on https", async () => {
    const req = new NextRequest("https://sifty.example/today", {
      headers: { cookie: "__Secure-sifty.session_token=tok.sig" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("does not gate non-protected paths", async () => {
    const req = new NextRequest("http://localhost/sign-in");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("gates /redeem and keeps the invite code in `next`", async () => {
    const req = new NextRequest("http://localhost/redeem?code=sifty-abc");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "", "http://localhost");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/redeem?code=sifty-abc");
  });

  it("SIFTY_DISABLE_AUTH=1 short-circuits the gate", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    const req = new NextRequest("http://localhost/today");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
