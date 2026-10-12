#!/usr/bin/env node
/**
 * Run pending Drizzle migrations.
 *
 * Wraps `drizzle-kit migrate` so the Vercel build command can call it
 * unconditionally:
 *
 * - DATABASE_URL_UNPOOLED (direct) is preferred, DATABASE_URL otherwise.
 * - No URL on Vercel production: exit 1. A production build must never
 *   succeed against no database.
 * - No URL anywhere else (local dev, previews without a Neon branch, CI
 *   lint job): skip with a notice so the in-memory fallback keeps working.
 */
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const isProduction = process.env.VERCEL_ENV === "production";

if (!url) {
  if (isProduction) {
    console.error(
      "[migrate] DATABASE_URL is not set on a production build. Provision Neon (Vercel Marketplace) and redeploy.",
    );
    process.exit(1);
  }
  console.log("[migrate] DATABASE_URL is not set; skipping migrations (in-memory mode).");
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(result.status ?? 1);
