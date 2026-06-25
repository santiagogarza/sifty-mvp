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

let _override: Repos | null = null;
let _default: { repos: Repos; persistence: "postgres" | "memory" } | null = null;

export function setReposForTesting(repos: Repos | null): void {
  _override = repos;
  _default = null;
}

export function getRepos(): Repos {
  if (_override) return _override;
  if (_default) return _default.repos;
  _default = resolveDefault();
  return _default.repos;
}

export function getPersistenceMode(): "postgres" | "memory" {
  if (_override) return "memory";
  if (!_default) _default = resolveDefault();
  return _default.persistence;
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
