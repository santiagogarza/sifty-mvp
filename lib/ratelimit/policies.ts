import type { RateLimitConfig } from "./limiter";

/**
 * Rate-limit policies.
 *
 * Tuned for the threat model: cheap-to-call routes that hit paid services
 * (the model provider, Stripe). Generous enough that real users never
 * notice; tight enough that an abusive client can't burn the daily AI cap
 * out from under us in a few seconds.
 *
 * Policies are read from `process.env` *per call* (not at module load) so
 * tests can override them with `vi.stubEnv` without re-importing.
 */

export const TRIAGE_POLICY: RateLimitConfig = {
  get capacity() {
    return Number(process.env.RATELIMIT_TRIAGE_PER_MIN ?? 30);
  },
  windowMs: 60_000,
};

/**
 * Stripe inbound webhooks come from Stripe's IPs and we don't want to
 * meaningfully limit them, but we do want a coarse cap to stop a flood of
 * forged-but-rejected requests from melting the verification path.
 */
export const STRIPE_WEBHOOK_POLICY: RateLimitConfig = {
  get capacity() {
    return Number(process.env.RATELIMIT_STRIPE_WEBHOOK_PER_MIN ?? 240);
  },
  windowMs: 60_000,
};

/** Checkout / portal initiation. */
export const STRIPE_USER_POLICY: RateLimitConfig = {
  get capacity() {
    return Number(process.env.RATELIMIT_STRIPE_USER_PER_MIN ?? 12);
  },
  windowMs: 60_000,
};

/**
 * Best-effort client identifier. In production behind Vercel, the rightmost
 * value of `x-forwarded-for` is the proxy and we want the first.
 */
export function clientIdFromRequest(req: Request, fallback?: string | null): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return fallback ?? "anonymous";
}
