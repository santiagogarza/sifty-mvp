import type { UpstashRedisLike } from "@/lib/ratelimit/limiter";

/**
 * In-memory stand-in for `@upstash/redis` covering exactly what
 * `@upstash/ratelimit`'s fixed-window algorithm calls: `evalsha` (always
 * answers NOSCRIPT, like a fresh Redis), then `eval` with the Lua source.
 *
 * Instead of interpreting Lua, `eval` recognises the two fixed-window
 * scripts by the Redis commands they contain and reproduces their effect on
 * the key space. Expiry honours `Date.now()`, so `vi.useFakeTimers()` moves
 * windows along.
 */

interface Entry {
  value: number;
  expiresAt: number | null;
}

export class FakeUpstashRedis {
  readonly store = new Map<string, Entry>();
  /** Every `eval` call, for assertions on key naming. */
  readonly calls: Array<{ keys: string[]; args: unknown[] }> = [];
  /** When set, every command rejects with this error (simulated outage). */
  failWith: Error | null = null;

  private live(key: string): Entry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async evalsha(_sha: string, _keys: string[], _args: unknown[]): Promise<never> {
    if (this.failWith) throw this.failWith;
    throw new Error("NOSCRIPT No matching script. Please use EVAL.");
  }

  async eval(script: string, keys: string[], args: unknown[]): Promise<unknown> {
    if (this.failWith) throw this.failWith;
    this.calls.push({ keys, args });
    const key = keys[0]!;

    if (script.includes("INCRBY") && script.includes("PEXPIRE")) {
      // fixedWindow.limit: INCRBY key by ARGV[3], PEXPIRE on first write,
      // return { used, effectiveLimit }.
      const tokens = Number(args[0]);
      const windowMs = Number(args[1]);
      const incrementBy = Number(args[2] ?? 1);
      const entry = this.live(key);
      if (!entry) {
        this.store.set(key, { value: incrementBy, expiresAt: Date.now() + windowMs });
        return [incrementBy, tokens];
      }
      entry.value += incrementBy;
      return [entry.value, tokens];
    }

    if (script.includes("GET")) {
      // fixedWindow.getRemaining: { max(0, tokens - used), tokens }.
      const tokens = Number(args[0]);
      const used = this.live(key)?.value ?? 0;
      return [Math.max(0, tokens - used), tokens];
    }

    throw new Error(`FakeUpstashRedis: unsupported script\n${script}`);
  }

  async get<T = string>(key: string): Promise<T | null> {
    if (this.failWith) throw this.failWith;
    const entry = this.live(key);
    return entry ? (String(entry.value) as unknown as T) : null;
  }

  async set(key: string, value: unknown): Promise<"OK"> {
    if (this.failWith) throw this.failWith;
    this.store.set(key, { value: Number(value), expiresAt: null });
    return "OK";
  }

  /** Typed view for `createUpstashStore`. */
  asRedis(): UpstashRedisLike {
    return this as unknown as UpstashRedisLike;
  }
}
