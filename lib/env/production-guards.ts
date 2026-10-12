/**
 * Production environment guards.
 *
 * The demo flags below make local dev and the stage demos work without
 * keys, auth, or a database. None of them may ever be active on the live
 * product, so:
 *
 * - `assertProductionEnv()` runs at build time (`next.config.ts`) and at
 *   server start (`instrumentation.ts`) and throws when `VERCEL_ENV` is
 *   `production` and a demo flag is set or a required variable is missing.
 *   A bad deploy therefore fails before it serves a request.
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
    AUTH_SECRET: process.env.AUTH_SECRET,
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

/**
 * Human-readable problems that make `env` unfit for production. Empty when
 * the environment is acceptable. Pure, so it is unit-testable and can be
 * surfaced from `/api/health`.
 */
export function findProductionEnvProblems(env: Env = snapshotEnv()): string[] {
  const problems: string[] = [];

  for (const flag of DEMO_FLAGS) {
    const value = env[flag];
    if (value !== undefined && value !== "") {
      problems.push(`${flag} is set (${describe(value)}); demo flags are refused in production.`);
    }
  }

  if (!env.DATABASE_URL) {
    problems.push("DATABASE_URL is not set; the in-memory store is refused in production.");
  }

  const secret = env.AUTH_SECRET ?? "";
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(`AUTH_SECRET is missing or shorter than ${MIN_AUTH_SECRET_LENGTH} characters.`);
  }

  return problems;
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

/** Throws `ProductionEnvError` on Vercel production when the env is unsafe. No-op elsewhere. */
export function assertProductionEnv(env: Env = snapshotEnv()): void {
  if (!isVercelProduction(env)) return;
  const problems = findProductionEnvProblems(env);
  if (problems.length > 0) throw new ProductionEnvError(problems);
}

function describe(value: string): string {
  // SIFTY_USER_EMAIL carries an address; never echo flag values verbatim.
  return value === "1" ? "enabled" : "non-empty";
}
