import type { RateLimitConfig } from "./limiter";

/**
 * Rate-limit policies.
 *
 * Tuned for the threat model: cheap-to-call routes that hit paid services
 * (the model provider, Stripe) or that an attacker would hammer (sign-in,
 * invite redemption). Generous enough that real users never notice; tight
 * enough that an abusive client can't burn the daily AI cap out from under
 * us in a few seconds or brute-force a password.
 *
 * Every protected route carries two limits: one keyed by the acting subject
 * (user id, or email for sign-in/sign-up) and a wider one keyed by client
 * IP. The per-subject limit is what a single user can do; the per-IP limit
 * stops one source from spreading abuse across many accounts while leaving
 * room for a shared office or mobile-carrier NAT.
 *
 * Policies are read from `process.env` *per call* (not at module load) so
 * tests can override them with `vi.stubEnv` without re-importing.
 */

const MINUTE = 60_000;

function perMinute(envVar: string, fallback: number): RateLimitConfig {
  return {
    get capacity() {
      const raw = Number(process.env[envVar]);
      return Number.isFinite(raw) && raw > 0 ? raw : fallback;
    },
    windowMs: MINUTE,
  };
}

/** AI triage / brief: per user. */
export const TRIAGE_POLICY = perMinute("RATELIMIT_TRIAGE_PER_MIN", 30);
/** AI triage / brief: per client IP, across users. */
export const TRIAGE_IP_POLICY = perMinute("RATELIMIT_TRIAGE_IP_PER_MIN", 90);

/**
 * Stripe inbound webhooks come from Stripe's IPs and we don't want to
 * meaningfully limit them, but we do want a coarse cap to stop a flood of
 * forged-but-rejected requests from melting the verification path.
 */
export const STRIPE_WEBHOOK_POLICY = perMinute("RATELIMIT_STRIPE_WEBHOOK_PER_MIN", 240);

/** Checkout / portal initiation: per user. */
export const STRIPE_USER_POLICY = perMinute("RATELIMIT_STRIPE_USER_PER_MIN", 12);
/** Checkout / portal initiation: per client IP (checked before the session lookup). */
export const STRIPE_IP_POLICY = perMinute("RATELIMIT_STRIPE_IP_PER_MIN", 30);

/**
 * Invite-code redemption. Codes carry ~117 bits of entropy so guessing is
 * hopeless anyway; this cap exists so a scripted client cannot turn the
 * endpoint into a hashing treadmill.
 */
export const REDEEM_POLICY = perMinute("RATELIMIT_REDEEM_PER_MIN", 5);
export const REDEEM_IP_POLICY = perMinute("RATELIMIT_REDEEM_IP_PER_MIN", 15);

/**
 * Auth mutations (`POST /api/auth/*`): sign-in, sign-up, sign-out, and
 * whatever the auth layer adds later (magic link, reset). Per email it is a
 * brute-force brake; per IP it bounds credential stuffing across accounts.
 */
export const AUTH_EMAIL_POLICY = perMinute("RATELIMIT_AUTH_EMAIL_PER_MIN", 5);
export const AUTH_IP_POLICY = perMinute("RATELIMIT_AUTH_IP_PER_MIN", 20);

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
