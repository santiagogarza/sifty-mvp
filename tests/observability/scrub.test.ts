import { SCRUBBED, scrubUrlsDeep, stripQuery } from "@/lib/observability/scrub";
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

describe("scrubUrlsDeep", () => {
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
