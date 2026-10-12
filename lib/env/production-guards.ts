/**
 * Production environment guards.
 *
 * The demo flags below make local dev and the stage demos work without
 * keys, auth, or a database. None of them may ever be active on the live
 * product, so:
 *
 * - `assertProductionEnv()` runs at build time (`next.config.ts`) and at
 *   server start (`instrumentation.ts`) and throws when `VERCEL_ENV` is
 *   `production` and a demo flag is set, the auth secret is missing, or
 *   `DATABASE_URL` is missing (the in-memory store would silently lose user
 *   data). A bad deploy therefore fails before it serves a request.
 * - `demoFlagEnabled()` is what every flag consumer reads. It is false on
 *   Vercel production regardless of the variable, so even if the boot
 *   guard were bypassed, auth, seeding, and offline AI stay off.
 *
 * `VERCEL_ENV` is set by Vercel (`production` | `preview` | `development`).
 * Preview deployments keep the flags usable for smoke runs.
 *
 * Every variable is read as a literal `process.env.NAME` inside
 * `snapshotEnv()`. The Edge bundler (middleware runs there) only ships
 * variables it can see statically; an aliased `env[name]` read would come
 * back undefined on Vercel.
 */

export const DEMO_FLAGS = [
  "SIFTY_DISABLE_AUTH",
  "SIFTY_DEMO_SEED",
  "SIFTY_AI_OFFLINE",
  "SIFTY_USER_EMAIL",
] as const;

export type DemoFlag = (typeof DEMO_FLAGS)[number];

type Env = Record<string, string | undefined>;

const MIN_AUTH_SECRET_LENGTH = 32;

/** The variables the guards care about, read statically so Edge sees them. */
export function snapshotEnv(): Env {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    SIFTY_DISABLE_AUTH: process.env.SIFTY_DISABLE_AUTH,
    SIFTY_DEMO_SEED: process.env.SIFTY_DEMO_SEED,
    SIFTY_AI_OFFLINE: process.env.SIFTY_AI_OFFLINE,
    SIFTY_USER_EMAIL: process.env.SIFTY_USER_EMAIL,
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };
}

export function isVercelProduction(env: Env = snapshotEnv()): boolean {
  return env.VERCEL_ENV === "production";
}

/** True only when the flag is `"1"` and we are not on Vercel production. */
export function demoFlagEnabled(flag: DemoFlag, env: Env = snapshotEnv()): boolean {
  if (isVercelProduction(env)) return false;
  return env[flag] === "1";
}

export interface ProductionEnvProblems {
  /** Refuse to build or boot. */
  blocking: string[];
  /** Boot, but say so loudly (logs, `/api/health` 503). Currently none. */
  warnings: string[];
}

/**
 * Problems that make `env` unfit for production, split by severity. Both
 * lists are empty when the environment is acceptable. Pure, so it is
 * unit-testable and can be surfaced from `/api/health`.
 */
export function findProductionEnvProblems(env: Env = snapshotEnv()): ProductionEnvProblems {
  const blocking: string[] = [];
  const warnings: string[] = [];

  for (const flag of DEMO_FLAGS) {
    const value = env[flag];
    if (value !== undefined && value !== "") {
      blocking.push(`${flag} is set (${describe(value)}); demo flags are refused in production.`);
    }
  }

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    blocking.push(
      `BETTER_AUTH_SECRET is missing or shorter than ${MIN_AUTH_SECRET_LENGTH} characters.`,
    );
  }

  if (!env.DATABASE_URL) {
    blocking.push(
      "DATABASE_URL is not set; the in-memory store is refused in production because it loses all data on every restart. Connect Neon (Vercel Marketplace) and redeploy.",
    );
  }

  return { blocking, warnings };
}

export class ProductionEnvError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      [
        "Refusing to run: the environment is not safe for production.",
        ...problems.map((p) => `  - ${p}`),
        "Fix the variables in the Vercel project settings (Production scope) and redeploy.",
      ].join("\n"),
    );
    this.name = "ProductionEnvError";
    this.problems = problems;
  }
}

/**
 * Throws `ProductionEnvError` on Vercel production when the env is unsafe;
 * logs and returns the warnings otherwise. No-op off production.
 */
export function assertProductionEnv(env: Env = snapshotEnv()): string[] {
  if (!isVercelProduction(env)) return [];
  const { blocking, warnings } = findProductionEnvProblems(env);
  if (blocking.length > 0) throw new ProductionEnvError(blocking);
  for (const warning of warnings) console.error(`[production-guards] ${warning}`);
  return warnings;
}

function describe(value: string): string {
  // SIFTY_USER_EMAIL carries an address; never echo flag values verbatim.
  return value === "1" ? "enabled" : "non-empty";
}
