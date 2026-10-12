import { type MemoryReposHandle, createMemoryRepos } from "./memory";
import { createPostgresRepos } from "./pg";
import type { Repos } from "./types";

/**
 * Repository factory.
 *
 * Production: Postgres-backed implementation. We resolve it lazily so
 * importing this module never opens a connection (Postgres connections are
 * created on first query inside the repo functions, not at import time).
 *
 * Tests: call `setReposForTesting(createMemoryRepos())` in setup. Resetting
 * between tests is the test's responsibility (the memory handle exposes
 * `__reset()`).
 *
 * Local dev with no `DATABASE_URL`: falls back to in-memory so the app
 * still runs end-to-end. Routes set the `X-Sifty-Persistence: memory`
 * header so a developer notices when they have not configured a DB.
 */

type Resolved = { repos: Repos; persistence: "postgres" | "memory" };

/**
 * The default is pinned on `globalThis`, not a module variable: `next dev`
 * evaluates this module once per server bundle (route handlers and layouts
 * are separate), and two in-memory stores would mean a session written by
 * `/api/auth` is invisible to the `(app)` layout.
 */
const globalStore = globalThis as typeof globalThis & { __siftyRepos?: Resolved | null };

let _override: Repos | null = null;

export function setReposForTesting(repos: Repos | null): void {
  _override = repos;
  globalStore.__siftyRepos = null;
}

export function getRepos(): Repos {
  if (_override) return _override;
  return resolved().repos;
}

export function getPersistenceMode(): "postgres" | "memory" {
  if (_override) return "memory";
  return resolved().persistence;
}

function resolved(): Resolved {
  if (!globalStore.__siftyRepos) globalStore.__siftyRepos = resolveDefault();
  return globalStore.__siftyRepos;
}

function resolveDefault(): { repos: Repos; persistence: "postgres" | "memory" } {
  const hasUrl = !!process.env.DATABASE_URL;
  if (!hasUrl) {
    return { repos: createMemoryRepos(), persistence: "memory" };
  }
  return { repos: createPostgresRepos(), persistence: "postgres" };
}

export type { Repos };
export { createMemoryRepos };
export type { MemoryReposHandle };
