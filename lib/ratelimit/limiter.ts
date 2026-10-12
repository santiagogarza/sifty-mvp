/**
 * Fixed-window rate limiter behind one `consumeToken` seam.
 *
 * Two interchangeable stores implement the same contract (same capacity,
 * same window, same aligned-window semantics), so a route's limit means the
 * same thing wherever it runs:
 *
 * - **Upstash Redis** (`@upstash/ratelimit` fixed window) when
 *   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the Marketplace
 *   `KV_REST_API_*` names) are set — shared across every serverless instance
 *   and region. If Redis errors or times out the request falls through to
 *   the in-process store instead of being dropped (fail open, but still
 *   bounded per instance), and the failure is reported.
 * - **In-process** `Map` otherwise — per instance, which is still enough to
 *   stop same-instance bursts. AI routes additionally use the persistent
 *   `ai_runs` sliding window (see `lib/ai/ai-gate.ts`) so the paid path is
 *   bounded across instances even without Redis.
 *
 * Windows are aligned to the epoch (`floor(now / windowMs)`) in both stores;
 * that is what the Upstash algorithm does, and mirroring it here keeps the
 * fallback indistinguishable from the durable path.
 */

import { reportError } from "@/lib/observability/report-error";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitConfig {
  /** Number of tokens allowed in the window. */
  capacity: number;
  /** Window in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  readonly kind: "memory" | "upstash";
  consume(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
}

/** The subset of `@upstash/redis` that `@upstash/ratelimit` calls. */
export type UpstashRedisLike = ConstructorParameters<typeof Ratelimit>[0]["redis"];

const KEY_PREFIX = "sifty:rl";

// ---------------------------------------------------------------------------
// In-process store
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  resetAt: number;
}

// One map per process rather than per module instance: Next bundles each
// route handler separately, and `globalThis` is the only thing they share.
const BUCKETS_KEY = Symbol.for("sifty.ratelimit.buckets");
type BucketGlobal = typeof globalThis & { [BUCKETS_KEY]?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  const g = globalThis as BucketGlobal;
  g[BUCKETS_KEY] ??= new Map();
  return g[BUCKETS_KEY];
}

function windowBounds(now: number, windowMs: number): { bucket: number; resetAt: number } {
  const bucket = Math.floor(now / windowMs);
  return { bucket, resetAt: (bucket + 1) * windowMs };
}

function retryAfter(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

export function createMemoryStore(): RateLimitStore {
  return {
    kind: "memory",
    async consume(key, config) {
      const now = Date.now();
      const { bucket, resetAt } = windowBounds(now, config.windowMs);
      const bucketKey = `${key}:${bucket}`;
      const map = buckets();
      const existing = map.get(bucketKey);
      if (!existing || existing.resetAt <= now) {
        // Opportunistically drop expired buckets so the map cannot grow
        // without bound on a long-lived instance.
        for (const [k, b] of map) if (b.resetAt <= now) map.delete(k);
        map.set(bucketKey, { tokens: config.capacity - 1, resetAt });
        return { ok: true, remaining: config.capacity - 1, retryAfterSeconds: 0 };
      }
      if (existing.tokens <= 0) {
        return { ok: false, remaining: 0, retryAfterSeconds: retryAfter(existing.resetAt, now) };
      }
      existing.tokens -= 1;
      return { ok: true, remaining: existing.tokens, retryAfterSeconds: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Upstash store
// ---------------------------------------------------------------------------

export interface UpstashStoreOptions {
  /** Milliseconds to wait for Redis before falling back. */
  timeoutMs?: number;
  /** Store used when Redis fails or times out. */
  fallback?: RateLimitStore;
}

export function createUpstashStore(
  redis: UpstashRedisLike,
  options: UpstashStoreOptions = {},
): RateLimitStore {
  const fallback = options.fallback ?? createMemoryStore();
  const timeout = options.timeoutMs ?? 2000;
  // One `Ratelimit` per (capacity, window): policies read their capacity
  // from env per call, so the instance cannot be fixed at module load.
  const limiters = new Map<string, Ratelimit>();

  function limiterFor(config: RateLimitConfig): Ratelimit {
    const id = `${config.capacity}:${config.windowMs}`;
    let limiter = limiters.get(id);
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(config.capacity, `${config.windowMs} ms`),
        prefix: KEY_PREFIX,
        analytics: false,
        timeout,
      });
      limiters.set(id, limiter);
    }
    return limiter;
  }

  return {
    kind: "upstash",
    async consume(key, config) {
      try {
        const res = await limiterFor(config).limit(key);
        if (res.reason === "timeout") {
          reportError(new Error("Upstash rate limit timed out"), {
            area: "ratelimit.upstash",
            tags: { scope: keyScope(key), timeoutMs: timeout },
          });
          return fallback.consume(key, config);
        }
        const now = Date.now();
        return {
          ok: res.success,
          remaining: res.remaining,
          retryAfterSeconds: res.success ? 0 : retryAfter(res.reset, now),
        };
      } catch (err) {
        reportError(err, { area: "ratelimit.upstash", tags: { scope: keyScope(key) } });
        return fallback.consume(key, config);
      }
    },
  };
}

/**
 * `route:scope` prefix of a key, without the identifier. Subject keys carry
 * emails and user ids, which must not end up in error logs.
 */
function keyScope(key: string): string {
  return key.split(":").slice(0, 2).join(":");
}

// ---------------------------------------------------------------------------
// Store resolution
// ---------------------------------------------------------------------------

export function upstashCredentialsFromEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

const STORE_KEY = Symbol.for("sifty.ratelimit.store");
type StoreGlobal = typeof globalThis & {
  [STORE_KEY]?: { store: RateLimitStore; credentials: string | null } | null;
};

let testOverride: RateLimitStore | null = null;

/** Resolve the store from env once; re-resolve if the credentials change. */
export function resolveRateLimitStore(): RateLimitStore {
  if (testOverride) return testOverride;
  const g = globalThis as StoreGlobal;
  const creds = upstashCredentialsFromEnv();
  const fingerprint = creds ? `${creds.url}|${creds.token}` : null;
  const cached = g[STORE_KEY];
  if (cached && cached.credentials === fingerprint) return cached.store;
  const store = creds
    ? createUpstashStore(new Redis({ url: creds.url, token: creds.token }))
    : createMemoryStore();
  g[STORE_KEY] = { store, credentials: fingerprint };
  return store;
}

export async function consumeToken(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  return resolveRateLimitStore().consume(key, config);
}

/** Test-only: force a store (pass `null` to go back to env resolution). */
export function setRateLimitStoreForTesting(store: RateLimitStore | null): void {
  testOverride = store;
}

/** Test-only helper: clear in-process buckets and any forced store. */
export function __resetRateLimits(): void {
  buckets().clear();
  testOverride = null;
  (globalThis as StoreGlobal)[STORE_KEY] = null;
}

export function buildRateLimitKey(
  prefix: string,
  ...parts: Array<string | null | undefined>
): string {
  return [prefix, ...parts.filter(Boolean)].join(":");
}

export function rateLimitResponseInit(result: RateLimitResult): {
  status: number;
  headers: Record<string, string>;
} {
  return {
    status: 429,
    headers: {
      "Retry-After": String(result.retryAfterSeconds),
      "X-RateLimit-Remaining": String(result.remaining),
    },
  };
}
