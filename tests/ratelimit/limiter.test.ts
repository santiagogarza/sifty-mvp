import { reportError } from "@/lib/observability/report-error";
import {
  type RateLimitConfig,
  type RateLimitStore,
  __resetRateLimits,
  consumeToken,
  createMemoryStore,
  createUpstashStore,
  resolveRateLimitStore,
  setRateLimitStoreForTesting,
} from "@/lib/ratelimit/limiter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUpstashRedis } from "../helpers/fake-upstash-redis";

vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));

const POLICY: RateLimitConfig = { capacity: 3, windowMs: 60_000 };

// Aligned-window semantics: start every test 10 s into a minute so a
// window boundary never lands mid-test.
const T0 = Date.UTC(2026, 0, 1, 12, 0, 10);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __resetRateLimits();
  vi.mocked(reportError).mockClear();
});

afterEach(() => {
  __resetRateLimits();
  vi.useRealTimers();
});

/** Drive a store through one window and return the sequence of results. */
async function exercise(store: RateLimitStore) {
  const results: Array<{ ok: boolean; remaining: number; retryAfterSeconds: number }> = [];
  for (let i = 0; i < 5; i += 1) results.push(await store.consume("k:user-1", POLICY));
  // A different key has its own budget.
  results.push(await store.consume("k:user-2", POLICY));
  // The next window reopens the budget.
  vi.setSystemTime(T0 + 60_000);
  results.push(await store.consume("k:user-1", POLICY));
  return results;
}

const EXPECTED = [
  { ok: true, remaining: 2, retryAfterSeconds: 0 },
  { ok: true, remaining: 1, retryAfterSeconds: 0 },
  { ok: true, remaining: 0, retryAfterSeconds: 0 },
  // 50 s left in the aligned minute at T0 (+10 s).
  { ok: false, remaining: 0, retryAfterSeconds: 50 },
  { ok: false, remaining: 0, retryAfterSeconds: 50 },
  { ok: true, remaining: 2, retryAfterSeconds: 0 },
  { ok: true, remaining: 2, retryAfterSeconds: 0 },
];

describe("rate limit stores", () => {
  it("in-process store: fixed aligned window with Retry-After to the window edge", async () => {
    expect(await exercise(createMemoryStore())).toEqual(EXPECTED);
  });

  it("upstash store: identical results against a fake Redis", async () => {
    const redis = new FakeUpstashRedis();
    expect(await exercise(createUpstashStore(redis.asRedis()))).toEqual(EXPECTED);
    // Keys are namespaced and bucketed by window, so two instances sharing
    // the Redis share the budget.
    expect(redis.calls[0]!.keys[0]).toMatch(/^sifty:rl:k:user-1:\d+$/);
  });

  it("upstash store: two instances share one budget through Redis", async () => {
    const redis = new FakeUpstashRedis();
    const a = createUpstashStore(redis.asRedis());
    const b = createUpstashStore(redis.asRedis());
    expect((await a.consume("k", POLICY)).ok).toBe(true);
    expect((await b.consume("k", POLICY)).ok).toBe(true);
    expect((await a.consume("k", POLICY)).ok).toBe(true);
    const denied = await b.consume("k", POLICY);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBe(50);
  });

  it("upstash store: falls back to the in-process budget and reports when Redis is down", async () => {
    const redis = new FakeUpstashRedis();
    redis.failWith = new Error("ECONNRESET");
    const store = createUpstashStore(redis.asRedis());
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push((await store.consume("auth:subject:victim@example.com", POLICY)).ok);
    }
    expect(results).toEqual([true, true, true, false]);
    expect(reportError).toHaveBeenCalled();
    const ctx = vi.mocked(reportError).mock.calls[0]![1];
    expect(ctx).toMatchObject({ area: "ratelimit.upstash", tags: { scope: "auth:subject" } });
    // The identifier (here an email) never reaches the error sink.
    expect(JSON.stringify(ctx)).not.toContain("victim@example.com");
  });

  it("upstash store: a Redis timeout also falls back instead of failing open", async () => {
    const redis = new FakeUpstashRedis();
    const slow = new Promise<never>(() => {});
    redis.evalsha = () => slow;
    const store = createUpstashStore(redis.asRedis(), { timeoutMs: 50 });
    const pending = Promise.all([1, 2, 3, 4].map(() => store.consume("k", POLICY)));
    await vi.advanceTimersByTimeAsync(60);
    const results = (await pending).map((r) => r.ok);
    expect(results).toEqual([true, true, true, false]);
    expect(reportError).toHaveBeenCalled();
  });
});

describe("consumeToken store resolution", () => {
  it("uses the in-process store when no Upstash credentials are set", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    expect(resolveRateLimitStore().kind).toBe("memory");
  });

  it("switches to Upstash when UPSTASH_REDIS_REST_URL/TOKEN are set, and accepts the KV_* names", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    expect(resolveRateLimitStore().kind).toBe("upstash");

    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    expect(resolveRateLimitStore().kind).toBe("upstash");
  });

  it("consumeToken goes through the forced store", async () => {
    const redis = new FakeUpstashRedis();
    setRateLimitStoreForTesting(createUpstashStore(redis.asRedis()));
    await consumeToken("route:ip:1.2.3.4", POLICY);
    expect(redis.calls).toHaveLength(1);
    expect(redis.calls[0]!.keys[0]).toMatch(/^sifty:rl:route:ip:1\.2\.3\.4:\d+$/);
  });
});
