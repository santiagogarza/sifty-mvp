import { GET } from "@/app/api/health/route";
import { setReposForTesting } from "@/lib/db/repos";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports ok on the in-memory store outside production", async () => {
    vi.stubEnv("DATABASE_URL", "");
    setReposForTesting(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, persistence: "memory", db: "skipped", sentry: false });
    expect(body.problems).toEqual([]);
  });

  it("reports sentry as enabled when a DSN is configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    setReposForTesting(null);
    const body = await (await GET()).json();
    expect(body.sentry).toBe(true);
  });

  it("is 503 with the env problems on a misconfigured Vercel production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setReposForTesting(null);
    const res = await GET();
    error.mockRestore();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, persistence: "memory", db: "skipped" });
    expect(body.problems.some((p: string) => p.startsWith("SIFTY_DISABLE_AUTH"))).toBe(true);
    expect(body.problems.some((p: string) => p.startsWith("DATABASE_URL"))).toBe(true);
  });

  it("is 503 on Vercel production when running in memory, even with a clean env", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setReposForTesting(null);
    const res = await GET();
    error.mockRestore();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.problems).toHaveLength(1);
    expect(body.problems[0]).toMatch(/^DATABASE_URL/);
  });

  it("is 503 when Postgres is configured but unreachable", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://sifty:nope@127.0.0.1:1/unreachable");
    setReposForTesting(null);
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, persistence: "postgres", db: "error" });
    expect(JSON.stringify(body)).not.toContain("127.0.0.1:1");
  });
});
