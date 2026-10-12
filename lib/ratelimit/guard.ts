import { NextResponse } from "next/server";
import {
  type RateLimitConfig,
  type RateLimitResult,
  buildRateLimitKey,
  consumeToken,
  rateLimitResponseInit,
} from "./limiter";
import { clientIdFromRequest } from "./policies";

/**
 * Per-route admission: one limit keyed by client IP, optionally one keyed by
 * the acting subject (user id, email). Both draw from the shared
 * `consumeToken` store, so they are durable whenever Redis is configured.
 *
 * The IP limit is checked first so an unauthenticated flood is rejected
 * before any session or database work.
 */

export interface RouteLimitSpec {
  /** Key prefix, e.g. `"triage"`. One prefix per route family. */
  route: string;
  /** Per-client-IP policy; omit when another layer (middleware) already applies one. */
  ip?: RateLimitConfig | null;
  /** Per-subject policy; skipped when `id` is empty. */
  subject?: { id: string | null | undefined; policy: RateLimitConfig } | null;
  /** User-facing message for the 429 body. */
  message: string;
}

export type RateLimitGateResult =
  | { ok: true }
  | { ok: false; scope: "ip" | "subject"; result: RateLimitResult; response: NextResponse };

export async function enforceRateLimit(
  req: Request,
  spec: RouteLimitSpec,
): Promise<RateLimitGateResult> {
  if (spec.ip) {
    const ip = await consumeToken(
      buildRateLimitKey(spec.route, "ip", clientIdFromRequest(req)),
      spec.ip,
    );
    if (!ip.ok) return deny("ip", ip, spec.message);
  }

  if (spec.subject?.id) {
    const subject = await consumeToken(
      buildRateLimitKey(spec.route, "subject", spec.subject.id),
      spec.subject.policy,
    );
    if (!subject.ok) return deny("subject", subject, spec.message);
  }

  return { ok: true };
}

function deny(
  scope: "ip" | "subject",
  result: RateLimitResult,
  message: string,
): RateLimitGateResult {
  return {
    ok: false,
    scope,
    result,
    // `error` is what the app's own fetch helpers read; `message` is what the
    // Better Auth client surfaces, so the middleware 429 on `/api/auth/*`
    // shows the same sentence in the sign-in form as the per-email hook.
    response: NextResponse.json(
      { error: message, message, code: "rate_limited" },
      rateLimitResponseInit(result),
    ),
  };
}
