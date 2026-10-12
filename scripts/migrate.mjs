#!/usr/bin/env node
/**
 * Run pending Drizzle migrations.
 *
 * Wraps `drizzle-kit migrate` so the Vercel build command can call it
 * unconditionally:
 *
 * - DATABASE_URL_UNPOOLED (direct) is preferred, DATABASE_URL otherwise.
 *   Empty or whitespace-only values count as unset.
 * - `.env.local` then `.env` are loaded (without overriding the process
 *   env), matching the documented local workflow.
 * - Preview deployments skip migrations unless SIFTY_MIGRATE_PREVIEWS=1:
 *   without Neon preview branching they share the production database, and
 *   an unmerged branch must never alter the production schema.
 * - No URL: skip. Outside production that is routine (local dev, CI lint
 *   job). On Vercel production it is logged as an error so the first deploy
 *   can render in memory mode before Neon exists; the app's boot guard and
 *   /api/health flag the same condition.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @typedef {{ action: "run", url: string } | { action: "skip", loud: boolean, message: string }} Plan */

/**
 * Pure decision, so tests can cover every branch without a database.
 * @param {Record<string, string | undefined>} env
 * @returns {Plan}
 */
export function planMigration(env) {
  const url = (env.DATABASE_URL_UNPOOLED ?? "").trim() || (env.DATABASE_URL ?? "").trim();
  if (env.VERCEL_ENV === "preview" && env.SIFTY_MIGRATE_PREVIEWS !== "1") {
    return {
      action: "skip",
      loud: false,
      message:
        "[migrate] preview deployment; skipping migrations (set SIFTY_MIGRATE_PREVIEWS=1 once Neon preview branching is on).",
    };
  }
  if (url) return { action: "run", url };
  if (env.VERCEL_ENV === "production") {
    return {
      action: "skip",
      loud: true,
      message:
        "[migrate] DATABASE_URL is not set on a production build; skipping migrations. The app runs on the in-memory store until Neon (Vercel Marketplace) is provisioned.",
    };
  }
  return {
    action: "skip",
    loud: false,
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
  if (plan.action === "skip") {
    (plan.loud ? console.error : console.log)(plan.message);
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
