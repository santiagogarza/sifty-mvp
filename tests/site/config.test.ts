import { GET as securityTxtRoute } from "@/app/.well-known/security.txt/route";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { CREATOR_EMAIL } from "@/lib/auth/session-shared";
import { LEGAL_ENTITY, PROCESSORS, getSiteUrl, getSupportEmail } from "@/lib/site/config";
import { buildSecurityTxt } from "@/lib/site/security-txt";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.stubEnv("SUPPORT_EMAIL", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
});

describe("getSupportEmail", () => {
  it("falls back to the operator email when unset", () => {
    expect(getSupportEmail()).toBe(CREATOR_EMAIL);
  });

  it("uses SUPPORT_EMAIL when it looks like an address", () => {
    vi.stubEnv("SUPPORT_EMAIL", "  help@example.com ");
    expect(getSupportEmail()).toBe("help@example.com");
  });

  it("ignores a malformed SUPPORT_EMAIL", () => {
    vi.stubEnv("SUPPORT_EMAIL", "not-an-email");
    expect(getSupportEmail()).toBe(CREATOR_EMAIL);
  });
});

describe("getSiteUrl", () => {
  it("prefers NEXT_PUBLIC_APP_URL and strips trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.vercel.app/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "other.vercel.app");
    expect(getSiteUrl()).toBe("https://sifty.vercel.app");
  });

  it("falls back to the Vercel production host", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "sifty.vercel.app");
    expect(getSiteUrl()).toBe("https://sifty.vercel.app");
  });

  it("defaults to localhost", () => {
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});

describe("legal constants", () => {
  it("names the entity and every processor from the plan", () => {
    expect(LEGAL_ENTITY).toBe("Waimaka, Inc");
    const names = PROCESSORS.map((p) => p.name);
    for (const required of ["Vercel", "Neon", "Stripe", "Resend", "Vercel AI Gateway", "Sentry"]) {
      expect(names).toContain(required);
    }
  });
});

describe("security.txt", () => {
  it("includes the RFC 9116 required fields with a one-year expiry", () => {
    vi.stubEnv("SUPPORT_EMAIL", "security@example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.vercel.app");
    const now = new Date("2026-10-12T00:00:00Z");
    const body = buildSecurityTxt(now);
    expect(body).toContain("Contact: mailto:security@example.com");
    expect(body).toContain("Expires: 2027-10-12T00:00:00.000Z");
    expect(body).toContain("Canonical: https://sifty.vercel.app/.well-known/security.txt");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("serves as plain text", async () => {
    const res = securityTxtRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    expect(await res.text()).toMatch(/^Contact: mailto:/);
  });
});

describe("robots and sitemap", () => {
  it("keeps the signed-in app and API out of the index", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.vercel.app");
    const out = robots();
    const rule = Array.isArray(out.rules) ? out.rules[0]! : out.rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/today", "/settings"]));
    expect(out.sitemap).toBe("https://sifty.vercel.app/sitemap.xml");
  });

  it("lists the public pages as absolute URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.vercel.app");
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://sifty.vercel.app/",
        "https://sifty.vercel.app/pricing",
        "https://sifty.vercel.app/privacy",
        "https://sifty.vercel.app/terms",
      ]),
    );
    expect(urls.some((u) => u.includes("/today"))).toBe(false);
  });
});
