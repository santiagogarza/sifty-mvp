import type { Session } from "@/lib/auth/session";
import { canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { demoFlagEnabled, isVercelProduction } from "@/lib/env/production-guards";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { TRIAGE_IP_POLICY, TRIAGE_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { countAiRunsSince, countAiRunsToday } from "./ai-runs";

/**
 * Shared admission control for AI routes (triage, agent brief).
 *
 * Three gates, cheapest first:
 *
 * 1. Fixed-window limits per client IP (`gateAiRequestByIp`, before the
 *    session lookup) and per user (`consumeToken`): durable in Upstash Redis
 *    when configured, otherwise per instance.
 * 2. Persistent sliding window over `ai_runs` — holds across serverless
 *    instances even without Redis. Runs are recorded after completion, so a
 *    parallel burst can momentarily exceed the cap before the window
 *    catches up; the bucket covers that gap and the window converges within
 *    one request round-trip.
 * 3. Entitlement (tier caps: `siftsPerDay`) — 402 with a `code` of
 *    `free_cap` (upgrade path) or `fair_use_cap` (Pro ceiling).
 */

const TOO_MANY = "Too many AI requests. Slow down a bit.";

export type AiGateResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Per-IP half of gate 1. Routes call this *before* `getSession()` so an
 * unauthenticated flood spends its IP budget instead of free session lookups.
 */
export async function gateAiRequestByIp(req: Request, bucket: string): Promise<AiGateResult> {
  const limit = await enforceRateLimit(req, {
    route: bucket,
    ip: TRIAGE_IP_POLICY,
    message: TOO_MANY,
  });
  return limit.ok ? { ok: true } : { ok: false, response: limit.response };
}

export async function gateAiRequest(args: {
  req: Request;
  session: Session;
  bucket: string;
}): Promise<AiGateResult> {
  const { req, session, bucket } = args;
  const userId = session.user.id;

  const limit = await enforceRateLimit(req, {
    route: bucket,
    subject: { id: userId, policy: TRIAGE_POLICY },
    message: TOO_MANY,
  });
  if (!limit.ok) return { ok: false, response: limit.response };

  const windowStart = new Date(Date.now() - TRIAGE_POLICY.windowMs);
  const [runsInWindow, aiRunsToday] = await Promise.all([
    countAiRunsSince(userId, windowStart),
    countAiRunsToday(userId),
  ]);

  if (runsInWindow >= TRIAGE_POLICY.capacity) {
    const retryAfterSeconds = Math.max(1, Math.ceil(TRIAGE_POLICY.windowMs / 1000 / 2));
    return {
      ok: false,
      response: NextResponse.json(
        { error: TOO_MANY, message: TOO_MANY, code: "rate_limited" },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
            "X-RateLimit-Remaining": "0",
          },
        },
      ),
    };
  }

  const entitlement = deriveEntitlement({
    profile: session.user,
    snapshot: session.entitlement,
    siftsToday: aiRunsToday,
  });
  const allowed = canRunAi(entitlement);
  if (!allowed.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: allowed.reason, code: allowed.code, entitlement },
        { status: 402 },
      ),
    };
  }

  return { ok: true };
}

/**
 * AI routes honor the explicit query flag or the keyless-dev environment
 * flag. Both are debug switches and neither works on Vercel production.
 */
export function resolveOfflineMode(req: Request): boolean {
  if (isVercelProduction()) return false;
  const url = new URL(req.url);
  return url.searchParams.get("offline") === "1" || demoFlagEnabled("SIFTY_AI_OFFLINE");
}
