import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without type declarations
import { planMigration } from "../../scripts/migrate.mjs";

const SCRIPT = resolve(__dirname, "../../scripts/migrate.mjs");

describe("planMigration", () => {
  it("prefers the unpooled URL and treats empty values as unset", () => {
    expect(
      planMigration({ DATABASE_URL_UNPOOLED: "postgres://direct", DATABASE_URL: "x" }),
    ).toEqual({ action: "run", url: "postgres://direct" });
    expect(planMigration({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: "postgres://pooled" })).toEqual(
      { action: "run", url: "postgres://pooled" },
    );
  });

  it("skips without a URL outside production", () => {
    expect(planMigration({}).action).toBe("skip");
    expect(planMigration({ VERCEL_ENV: "preview", DATABASE_URL: "" }).action).toBe("skip");
  });

  it("fails without a URL on Vercel production", () => {
    const plan = planMigration({ VERCEL_ENV: "production", DATABASE_URL_UNPOOLED: "" });
    expect(plan.action).toBe("fail");
    expect(plan.action === "fail" && plan.message).toContain("DATABASE_URL");
  });
});

describe("scripts/migrate.mjs process", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function run(env: Record<string, string>, envLocal?: string) {
    const cwd = mkdtempSync(join(tmpdir(), "sifty-migrate-"));
    dirs.push(cwd);
    if (envLocal !== undefined) writeFileSync(join(cwd, ".env.local"), envLocal);
    // Replace the inherited env so a developer's shell cannot leak a DB in.
    const clean: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...env,
    };
    return spawnSync(process.execPath, [SCRIPT], { cwd, env: clean, encoding: "utf8" });
  }

  it("exits 0 and says it skipped when no database is configured", () => {
    const res = run({});
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("skipping migrations");
  });

  it("exits 1 on Vercel production without a database", () => {
    const res = run({ VERCEL_ENV: "production" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("production build");
  });

  it("reads DATABASE_URL from .env.local and attempts the migration", () => {
    // An unroutable port makes drizzle-kit fail fast; what matters is that
    // the script got past the skip branch because of the env file.
    const res = run(
      { PNPM_HOME: process.env.PNPM_HOME ?? "" },
      "DATABASE_URL=postgres://u:p@127.0.0.1:1/x\n",
    );
    expect(res.stdout).not.toContain("skipping migrations");
    expect(res.status).not.toBe(0);
  });
});
