import { botDeniedResponse, verifyNotBot } from "@/lib/abuse/botid";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { InviteNotConfiguredError } from "@/lib/invites/codes";
import { REDEEM_MESSAGES, type RedeemFailure, redeemInviteCode } from "@/lib/invites/service";
import { reportError } from "@/lib/observability/report-error";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { REDEEM_IP_POLICY, REDEEM_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  code: z.string().min(1).max(64),
});

const STATUS_BY_REASON: Record<RedeemFailure, number> = {
  malformed: 400,
  unknown: 404,
  revoked: 410,
  expired: 410,
  exhausted: 410,
  already_redeemed: 409,
};

/**
 * Redeem an invite code for the signed-in user. Rate-limited per user and
 * per client IP so the endpoint cannot be used to probe codes, even though
 * their entropy already makes probing pointless; BotID keeps scripted
 * redemption farms out.
 */
export async function POST(req: Request) {
  // IP first, before the session lookup, so an unauthenticated flood spends
  // its budget here instead of on free 401s.
  const ipLimit = await enforceRateLimit(req, {
    route: "redeem",
    ip: REDEEM_IP_POLICY,
    message: "Too many attempts. Try again in a minute.",
  });
  if (!ipLimit.ok) return ipLimit.response;

  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = await enforceRateLimit(req, {
    route: "redeem",
    subject: { id: session.user.id, policy: REDEEM_POLICY },
    message: "Too many attempts. Try again in a minute.",
  });
  if (!limit.ok) return limit.response;

  const bot = await verifyNotBot("invites.redeem");
  if (bot.isBot) return botDeniedResponse();

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an invite code." }, { status: 400 });
  }

  try {
    const result = await redeemInviteCode(getRepos(), {
      userId: session.user.id,
      isCreator: session.user.isCreator,
      code: parsed.data.code,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: REDEEM_MESSAGES[result.reason], code: result.reason },
        { status: STATUS_BY_REASON[result.reason] },
      );
    }
    return NextResponse.json({ ok: true, tier: result.tier, compedUntil: result.compedUntil });
  } catch (err) {
    if (err instanceof InviteNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    reportError(err, { area: "invites.redeem", userId: session.user.id });
    return NextResponse.json({ error: "Could not redeem the code right now." }, { status: 500 });
  }
}
