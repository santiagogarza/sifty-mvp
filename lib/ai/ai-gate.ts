import type { Session } from "@/lib/auth/session";
import { canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { TRIAGE_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { countAiRunsSince, countAiRunsToday } from "./ai-runs";

/**
 * Shared admission control for AI routes (triage, agent brief).
 *
 * Three gates, cheapest first:
 *
 * 1. In-process token bucket — instant rejection of same-instance bursts.
 * 2. Persistent sliding window over `ai_runs` — holds across serverless
 *    instances, where the in-process bucket does not. Runs are recorded
 *    after completion, so a parallel burst can momentarily exceed the cap
 *    before the window catches up; the bucket covers that gap on-instance
 *    and the window converges within one request round-trip.
 * 3. Entitlement (creator/trial/subscription + daily cap) — 402.
 */

export type AiGateResult = { ok: true } | { ok: false; response: NextResponse };

export async function gateAiRequest(args: {
  req: Request;
  session: Session;
  bucket: string;
}): Promise<AiGateResult> {
  const { req, session, bucket } = args;
  const userId = session.user.id;

  const local = consumeToken(
    buildRateLimitKey(bucket, userId, clientIdFromRequest(req)),
    TRIAGE_POLICY,
  );
  if (!local.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many AI requests. Slow down a bit." },
        rateLimitResponseInit(local),
      ),
    };
  }

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
        { error: "Too many AI requests. Slow down a bit." },
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
    trialStartedAt: session.trialStartedAt,
    subscriptionActive: session.subscriptionActive,
    aiRunsToday,
  });
  const allowed = canRunAi(entitlement);
  if (!allowed.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: allowed.reason, entitlement }, { status: 402 }),
    };
  }

  return { ok: true };
}

/** AI routes honor the explicit query flag or the keyless-dev environment flag. */
export function resolveOfflineMode(req: Request): boolean {
  const url = new URL(req.url);
  return url.searchParams.get("offline") === "1" || process.env.SIFTY_AI_OFFLINE === "1";
}
