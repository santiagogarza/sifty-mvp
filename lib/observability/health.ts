import { getPersistenceMode } from "@/lib/db/repos";
import { findProductionEnvProblems, isVercelProduction } from "@/lib/env/production-guards";
import postgres from "postgres";
import { isSentryEnabled } from "./sentry";

export interface HealthReport {
  ok: boolean;
  env: string;
  release: string | null;
  persistence: "postgres" | "memory";
  db: "ok" | "error" | "skipped";
  sentry: boolean;
  /** Only populated on Vercel production (blocking first, then warnings); empty when healthy. */
  problems: string[];
  ts: string;
}

const DB_TIMEOUT_SECONDS = 3;
/** A healthy ping is reused this long; failures are always re-checked. */
const DB_PING_TTL_MS = 15_000;

let lastHealthyPing: { url: string; at: number } | null = null;

/**
 * Liveness + readiness in one call, for an external uptime check. Unauthenticated,
 * so it says *that* something is wrong, never *what* the connection string or
 * error text is.
 */
export async function checkHealth(): Promise<HealthReport> {
  const envProblems = isVercelProduction()
    ? findProductionEnvProblems()
    : { blocking: [], warnings: [] };
  const problems = [...envProblems.blocking, ...envProblems.warnings];
  let persistence: HealthReport["persistence"] = "memory";
  let db: HealthReport["db"] = "skipped";

  try {
    persistence = getPersistenceMode();
    if (persistence === "postgres") db = (await pingDbCached()) ? "ok" : "error";
  } catch {
    db = "error";
  }

  return {
    ok: problems.length === 0 && db !== "error",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    persistence,
    db,
    sentry: isSentryEnabled(),
    problems,
    ts: new Date().toISOString(),
  };
}

/**
 * Uptime checks hit this every minute, and each fresh connection costs a
 * second or more against a cold database, so a recent healthy result is
 * reused per warm instance.
 */
async function pingDbCached(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (url && lastHealthyPing?.url === url && Date.now() - lastHealthyPing.at < DB_PING_TTL_MS) {
    return true;
  }
  const ok = await pingDb();
  lastHealthyPing = ok && url ? { url, at: Date.now() } : null;
  return ok;
}

/**
 * One dedicated, short-lived connection with a hard connect/query timeout,
 * so a hung database cannot pin sockets in the shared pool between probes.
 */
async function pingDb(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const client = postgres(url, {
    max: 1,
    connect_timeout: DB_TIMEOUT_SECONDS,
    idle_timeout: 1,
    prepare: false,
    onnotice: () => {},
  });
  try {
    const query = client`select 1`.then(() => true);
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), DB_TIMEOUT_SECONDS * 1_000).unref?.(),
    );
    return await Promise.race([query, timeout]).catch(() => false);
  } finally {
    // Tears down the socket even when the query is still pending.
    void client.end({ timeout: 1 }).catch(() => {});
  }
}
