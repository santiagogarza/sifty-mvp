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
  BETTER_AUTH_SECRET: "x".repeat(32),
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
    expect(findProductionEnvProblems(SAFE_PRODUCTION)).toEqual({ blocking: [], warnings: [] });
    expect(assertProductionEnv(SAFE_PRODUCTION)).toEqual([]);
  });

  it("reports every demo flag that is set, without echoing its value", () => {
    const env = {
      ...SAFE_PRODUCTION,
      SIFTY_DISABLE_AUTH: "1",
      SIFTY_DEMO_SEED: "1",
      SIFTY_AI_OFFLINE: "0",
      SIFTY_USER_EMAIL: "someone@example.com",
    };
    const { blocking, warnings } = findProductionEnvProblems(env);
    expect(blocking).toHaveLength(4);
    expect(warnings).toEqual([]);
    for (const flag of DEMO_FLAGS) {
      expect(blocking.some((p) => p.startsWith(flag))).toBe(true);
    }
    expect(blocking.join("\n")).not.toContain("someone@example.com");
  });

  it("an empty-string flag is treated as unset", () => {
    expect(findProductionEnvProblems({ ...SAFE_PRODUCTION, SIFTY_DISABLE_AUTH: "" })).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  it("a short BETTER_AUTH_SECRET and a missing DATABASE_URL both block", () => {
    const { blocking, warnings } = findProductionEnvProblems({
      VERCEL_ENV: "production",
      BETTER_AUTH_SECRET: "short",
    });
    expect(blocking.some((p) => p.startsWith("BETTER_AUTH_SECRET"))).toBe(true);
    expect(blocking.some((p) => p.startsWith("DATABASE_URL"))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("assertProductionEnv refuses to boot without DATABASE_URL", () => {
    const { DATABASE_URL: _omit, ...noDb } = SAFE_PRODUCTION;
    expect(() => assertProductionEnv(noDb)).toThrow(ProductionEnvError);
    expect(() => assertProductionEnv(noDb)).toThrow(/DATABASE_URL is not set/);
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

describe("snapshotEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads every guarded variable from process.env at call time", async () => {
    const { snapshotEnv } = await import("@/lib/env/production-guards");
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(snapshotEnv()).toMatchObject({ SIFTY_DISABLE_AUTH: "1", VERCEL_ENV: "preview" });
    for (const flag of DEMO_FLAGS) expect(flag in snapshotEnv()).toBe(true);
    expect(demoFlagEnabled("SIFTY_DISABLE_AUTH")).toBe(true);
  });

  it("only uses literal process.env.NAME reads, which the Edge bundler can see", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/env/production-guards.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const literalReads = source.match(/process\.env\.[A-Z_]+/g) ?? [];
    expect(new Set(literalReads)).toEqual(
      new Set(
        [
          ...DEMO_FLAGS,
          "VERCEL_ENV",
          "DATABASE_URL",
          "BETTER_AUTH_SECRET",
          "VAPID_PUBLIC_KEY",
          "VAPID_PRIVATE_KEY",
          "VAPID_SUBJECT",
        ].map((k) => `process.env.${k}`),
      ),
    );
    expect(source).not.toMatch(/process\.env\[/);
    expect(source).not.toMatch(/=\s*process\.env\b(?!\.)/);
  });
});

describe("instrumentation.register", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to boot on Vercel production with a demo flag set", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@host/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    vi.stubEnv("SIFTY_DEMO_SEED", "1");
    await expect(register()).rejects.toBeInstanceOf(ProductionEnvError);
  });

  it("boots on Vercel production with a complete env", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@host/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
    await expect(register()).resolves.toBeUndefined();
  });
});
