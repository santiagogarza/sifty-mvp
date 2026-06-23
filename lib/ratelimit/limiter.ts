/**
 * Token-bucket rate limiter.
 *
 * Stage 4 ships an in-process limiter (per-instance state) for the triage
 * and Stripe routes. It's intentionally simple — under Vercel each
 * deployment instance carries its own buckets, which is fine for the
 * threat model here (cheap denial-of-cap-burning by abusive clients).
 *
 * For a stronger guarantee swap the storage to Redis or a Vercel KV-backed
 * implementation; the API stays the same.
 */

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

interface Bucket {
  tokens: number;
  resetAt: number;
}

const BUCKETS = new Map<string, Bucket>();

export function consumeToken(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const existing = BUCKETS.get(key);
  if (!existing || existing.resetAt <= now) {
    BUCKETS.set(key, { tokens: config.capacity - 1, resetAt: now + config.windowMs });
    return { ok: true, remaining: config.capacity - 1, retryAfterSeconds: 0 };
  }
  if (existing.tokens <= 0) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.tokens -= 1;
  return { ok: true, remaining: existing.tokens, retryAfterSeconds: 0 };
}

/** Test-only helper. */
export function __resetRateLimits(): void {
  BUCKETS.clear();
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
