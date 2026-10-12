import {
  SCRUBBED,
  redactAuthPath,
  scrubUrl,
  scrubUrlsDeep,
  stripQuery,
} from "@/lib/observability/scrub";
import { describe, expect, it } from "vitest";

describe("stripQuery", () => {
  it("drops the query string and fragment, keeps the path", () => {
    expect(stripQuery("/reset-password?token=abc")).toBe("/reset-password");
    expect(stripQuery("https://sifty-app.vercel.app/redeem?code=sifty-x#y")).toBe(
      "https://sifty-app.vercel.app/redeem",
    );
    expect(stripQuery("/sign-in?next=%2Fredeem%3Fcode%3Dsifty-x")).toBe("/sign-in");
    expect(stripQuery("/today")).toBe("/today");
    expect(stripQuery(undefined)).toBeUndefined();
    expect(stripQuery("")).toBeUndefined();
  });
});

describe("redactAuthPath / scrubUrl", () => {
  it("redacts bearer path segments under /api/auth and drops the query", () => {
    expect(redactAuthPath("https://app/api/auth/reset-password/SECRET")).toBe(
      "https://app/api/auth/reset-password/[redacted]",
    );
    expect(scrubUrl("https://app/api/auth/reset-password/SECRET?callbackURL=/reset-password")).toBe(
      "https://app/api/auth/reset-password/[redacted]",
    );
    expect(scrubUrl("/api/auth/magic-link/verify/TOKEN")).toBe("/api/auth/magic-link/[redacted]");
    expect(scrubUrl("/api/auth/sign-in/email")).toBe("/api/auth/sign-in/[redacted]");
    expect(scrubUrl("/api/auth/session")).toBe("/api/auth/session");
    expect(scrubUrl("/api/tasks/task_123")).toBe("/api/tasks/task_123");
  });
});

describe("scrubUrlsDeep", () => {
  it("scrubs transaction/span attributes that carry the raw request target", () => {
    const transaction = {
      type: "transaction",
      transaction: "GET /api/auth/reset-password/SECRET",
      contexts: {
        trace: {
          data: {
            "http.target": "/api/auth/reset-password/SECRET?callbackURL=/reset-password",
            "url.full": "https://app/sign-in?next=/redeem?code=sifty-secret",
            "url.query": "next=/redeem?code=sifty-secret",
            "next.span_name": "GET /redeem?code=sifty-secret",
          },
        },
      },
      spans: [
        {
          description: "GET /redeem?code=sifty-secret",
          data: { "http.target": "/redeem?code=sifty-secret" },
        },
      ],
    };
    const json = JSON.stringify(scrubUrlsDeep(transaction));
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("sifty-secret");
    expect(json).toContain("/api/auth/reset-password/[redacted]");
  });

  it("scrubs every URL-shaped string in a Sentry-like event", () => {
    const event = {
      request: {
        url: "https://sifty-app.vercel.app/reset-password?token=secret",
        headers: { Referer: "https://sifty-app.vercel.app/sign-in?next=%2Fredeem%3Fcode%3Dx" },
      },
      contexts: { nextjs: { request_path: "/redeem?code=sifty-secret" } },
      breadcrumbs: [
        {
          category: "navigation",
          data: { from: "/sign-in?next=/redeem?code=s", to: "/redeem?code=s" },
        },
      ],
      message: "plain text with code=notaurl stays",
    };
    const out = scrubUrlsDeep(event);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("code=sifty");
    expect(out.request.url).toBe("https://sifty-app.vercel.app/reset-password");
    expect(out.contexts.nextjs.request_path).toBe("/redeem");
    expect(out.breadcrumbs[0]?.data.to).toBe("/redeem");
    expect(out.message).toBe("plain text with code=notaurl stays");
    expect(scrubUrlsDeep("GET /redeem?code=sifty-secret")).toBe("GET /redeem");
    expect(
      scrubUrlsDeep("fetch failed for https://app/api/auth/reset-password/SECRET?x=1 (503)"),
    ).toBe("fetch failed for https://app/api/auth/reset-password/[redacted] (503)");
    expect(scrubUrlsDeep("3/4 done, 1/2 left")).toBe("3/4 done, 1/2 left");
  });

  it("removes query-shaped fields that Sentry stores separately from the URL", () => {
    const event = {
      request: {
        url: "https://sifty-app.vercel.app/reset-password",
        query_string: "token=secret-reset-token",
        headers: { Referer: "https://sifty-app.vercel.app/redeem" },
      },
      contexts: {
        nextjs: { request_path: "/redeem" },
        trace: { data: { query: { code: "sifty-secret" }, "http.query": "code=sifty-secret" } },
      },
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/redeem", query_params: [["code", "s"]] } },
      ],
    };
    const out = scrubUrlsDeep(event);
    const json = JSON.stringify(out);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("sifty-secret");
    expect(out.request.query_string).toBe(SCRUBBED);
    expect(out.contexts.trace.data.query).toBe(SCRUBBED);
    expect(out.breadcrumbs[0]?.data.query_params).toBe(SCRUBBED);
    expect(out.request.url).toBe("https://sifty-app.vercel.app/reset-password");
  });

  it("leaves non-URL values and primitives untouched", () => {
    expect(scrubUrlsDeep({ n: 1, ok: true, nested: { s: "hello" } })).toEqual({
      n: 1,
      ok: true,
      nested: { s: "hello" },
    });
    expect(scrubUrlsDeep(null)).toBeNull();
  });
});
