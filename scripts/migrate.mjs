#!/usr/bin/env node
/**
 * Run pending Drizzle migrations.
 *
 * Wraps `drizzle-kit migrate` so the Vercel build command can call it
 * unconditionally:
 *
 * - DATABASE_URL_UNPOOLED (direct) is preferred, DATABASE_URL otherwise.
 *   Empty values count as unset.
 * - `.env.local` then `.env` are loaded (without overriding the process
 *   env), matching the documented local workflow.
 * - No URL on Vercel production: exit 1. A production build must never
 *   succeed against no database.
 * - No URL anywhere else (local dev, previews without a Neon branch, CI
 *   lint job): skip with a notice so the in-memory fallback keeps working.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {{ action: "run", url: string } | { action: "skip" | "fail", message: string }} Plan */

/**
 * Pure decision, so tests can cover every branch without a database.
 * @param {Record<string, string | undefined>} env
 * @returns {Plan}
 */
export function planMigration(env) {
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "";
  if (url) return { action: "run", url };
  if (env.VERCEL_ENV === "production") {
    return {
      action: "fail",
      message:
        "[migrate] DATABASE_URL is not set on a production build. Provision Neon (Vercel Marketplace) and redeploy.",
    };
  }
  return {
    action: "skip",
    message: "[migrate] DATABASE_URL is not set; skipping migrations (in-memory mode).",
  };
}

/** Load `.env.local` then `.env` from `cwd`; existing variables win. */
export function loadEnvFiles(cwd = process.cwd()) {
  for (const name of [".env.local", ".env"]) {
    const file = resolve(cwd, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

function main() {
  loadEnvFiles();
  const plan = planMigration(process.env);
  if (plan.action === "fail") {
    console.error(plan.message);
    process.exit(1);
  }
  if (plan.action === "skip") {
    console.log(plan.message);
    process.exit(0);
  }
  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: plan.url, DATABASE_URL_UNPOOLED: plan.url },
  });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
