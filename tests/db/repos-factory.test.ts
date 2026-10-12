import { DatabaseNotConfiguredError } from "@/lib/db/client";
import { getPersistenceMode, getRepos, setReposForTesting } from "@/lib/db/repos";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `tests/setup.ts` installs an in-memory override before every test. These
 * cases drop it to exercise the real resolution logic, then put it back.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("repository factory", () => {
  it("falls back to memory without DATABASE_URL outside production", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    setReposForTesting(null);
    expect(getPersistenceMode()).toBe("memory");
    expect(getRepos()).toBeDefined();
  });

  it("refuses the memory fallback on Vercel production", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL_ENV", "production");
    setReposForTesting(null);
    expect(() => getRepos()).toThrow(DatabaseNotConfiguredError);
    expect(() => getPersistenceMode()).toThrow(DatabaseNotConfiguredError);
  });

  it("selects postgres when DATABASE_URL is set (no connection is opened)", () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@localhost:1/none");
    vi.stubEnv("VERCEL_ENV", "production");
    setReposForTesting(null);
    expect(getPersistenceMode()).toBe("postgres");
  });
});
