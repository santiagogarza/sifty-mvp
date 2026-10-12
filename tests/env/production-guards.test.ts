import { register } from "@/instrumentation";
import {
  DEMO_FLAGS,
  ProductionEnvError,
  assertProductionEnv,
  demoFlagEnabled,
  findProductionEnvProblems,
  isVercelProduction,
} from "@/lib/env/production-guards";
import { afterEach, describe, expect, it, vi } from "vitest";

const SAFE_PRODUCTION = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://user:pw@host/db",
  AUTH_SECRET: "x".repeat(32),
};

describe("production guards", () => {
  it("isVercelProduction only matches VERCEL_ENV=production", () => {
    expect(isVercelProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(isVercelProduction({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isVercelProduction({ VERCEL_ENV: "development" })).toBe(false);
    expect(isVercelProduction({})).toBe(false);
    expect(isVercelProduction({ NODE_ENV: "production" })).toBe(false);
  });

  it("demoFlagEnabled honors the flag locally and on previews", () => {
    expect(demoFlagEnabled("SIFTY_DISABLE_AUTH", { SIFTY_DISABLE_AUTH: "1" })).toBe(true);
    expect(
      demoFlagEnabled("SIFTY_DISABLE_AUTH", { SIFTY_DISABLE_AUTH: "1", VERCEL_ENV: "preview" }),
    ).toBe(true);
    expect(demoFlagEnabled("SIFTY_DISABLE_AUTH", { SIFTY_DISABLE_AUTH: "true" })).toBe(false);
    expect(demoFlagEnabled("SIFTY_DISABLE_AUTH", {})).toBe(false);
  });

  it("demoFlagEnabled is always false on Vercel production", () => {
    for (const flag of DEMO_FLAGS) {
      expect(demoFlagEnabled(flag, { ...SAFE_PRODUCTION, [flag]: "1" })).toBe(false);
    }
  });

  it("a complete production env has no problems", () => {
    expect(findProductionEnvProblems(SAFE_PRODUCTION)).toEqual([]);
    expect(() => assertProductionEnv(SAFE_PRODUCTION)).not.toThrow();
  });

  it("reports every demo flag that is set, without echoing its value", () => {
    const env = {
      ...SAFE_PRODUCTION,
      SIFTY_DISABLE_AUTH: "1",
      SIFTY_DEMO_SEED: "1",
      SIFTY_AI_OFFLINE: "0",
      SIFTY_USER_EMAIL: "someone@example.com",
    };
    const problems = findProductionEnvProblems(env);
    expect(problems).toHaveLength(4);
    for (const flag of DEMO_FLAGS) {
      expect(problems.some((p) => p.startsWith(flag))).toBe(true);
    }
    expect(problems.join("\n")).not.toContain("someone@example.com");
  });

  it("an empty-string flag is treated as unset", () => {
    expect(findProductionEnvProblems({ ...SAFE_PRODUCTION, SIFTY_DISABLE_AUTH: "" })).toEqual([]);
  });

  it("requires DATABASE_URL and a long enough AUTH_SECRET", () => {
    const problems = findProductionEnvProblems({ VERCEL_ENV: "production", AUTH_SECRET: "short" });
    expect(problems.some((p) => p.startsWith("DATABASE_URL"))).toBe(true);
    expect(problems.some((p) => p.startsWith("AUTH_SECRET"))).toBe(true);
  });

  it("assertProductionEnv throws a ProductionEnvError listing the problems", () => {
    const env = { ...SAFE_PRODUCTION, SIFTY_AI_OFFLINE: "1" };
    let caught: unknown;
    try {
      assertProductionEnv(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductionEnvError);
    const error = caught as ProductionEnvError;
    expect(error.problems).toHaveLength(1);
    expect(error.message).toContain("SIFTY_AI_OFFLINE");
    expect(error.message).toContain("Refusing to run");
  });

  it("assertProductionEnv is a no-op outside Vercel production", () => {
    const unsafe = { SIFTY_DISABLE_AUTH: "1", SIFTY_DEMO_SEED: "1", SIFTY_AI_OFFLINE: "1" };
    expect(() => assertProductionEnv(unsafe)).not.toThrow();
    expect(() => assertProductionEnv({ ...unsafe, VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertProductionEnv({ ...unsafe, NODE_ENV: "production" })).not.toThrow();
  });
});

describe("instrumentation.register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to boot on Vercel production with a demo flag set", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@host/db");
    vi.stubEnv("SIFTY_DEMO_SEED", "1");
    await expect(register()).rejects.toBeInstanceOf(ProductionEnvError);
  });

  it("boots on Vercel production with a complete env", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@host/db");
    await expect(register()).resolves.toBeUndefined();
  });
});
