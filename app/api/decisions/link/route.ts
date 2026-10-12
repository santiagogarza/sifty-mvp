import { gateAiRequestByIp, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { type Session, getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { answerDecision, dismissDecision } from "@/lib/decisions/actions";
import { verifyDecisionLinkToken } from "@/lib/decisions/links";
import { getSiteUrl } from "@/lib/site/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * One-tap links from digests and pushes: `?token=<jwt>`.
 *
 * The token is the credential (signed, 24 h, one decision, one action), so
 * no session is required — a tap from the mail app on a phone that has
 * never signed in still works. A session that *is* present must belong to
 * the token's user: a forwarded link opened in someone else's account is
 * refused (403) rather than acting on the wrong inbox.
 *
 * Every outcome redirects into `/decisions` with a `link=` status so the
 * page can say what happened; the API never renders HTML itself.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const verified = await verifyDecisionLinkToken(url.searchParams.get("token"));
  if (!verified.ok) return redirect(`/decisions?link=${verified.reason}`);
  const { claims } = verified;

  const session = await getSession(req);
  if (session && session.user.id !== claims.userId) {
    return NextResponse.json({ error: "This link belongs to another account" }, { status: 403 });
  }

  if (claims.link.action === "open") {
    return redirect(`/decisions?focus=${encodeURIComponent(claims.decisionId)}`);
  }

  const ipGate = await gateAiRequestByIp(req, "triage");
  if (!ipGate.ok) return ipGate.response;

  const actor = session ?? (await sessionForLinkUser(claims.userId));
  if (!actor) return redirect("/decisions?link=invalid");

  if (claims.link.action === "dismiss") {
    const result = await dismissDecision({ userId: actor.user.id, decisionId: claims.decisionId });
    return redirect(
      result.ok ? "/decisions?link=dismissed" : `/decisions?link=${linkFailure(result.reason)}`,
    );
  }

  const result = await answerDecision({
    req,
    session: actor,
    decisionId: claims.decisionId,
    answer: { text: null, option: claims.link.option, via: "link" },
    modelPreference: null,
    offline: resolveOfflineMode(req),
  });
  return redirect(
    result.ok ? "/decisions?link=answered" : `/decisions?link=${linkFailure(result.reason)}`,
  );
}

function linkFailure(reason: "not_found" | "already_resolved"): string {
  return reason === "already_resolved" ? "used" : "gone";
}

function redirect(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getSiteUrl()), 303);
}

/**
 * A session-shaped actor for the token's user, so the shared actions run
 * under the same entitlement checks a signed-in request would.
 */
async function sessionForLinkUser(userId: string): Promise<Session | null> {
  const repos = getRepos();
  const user = await repos.users.getById(userId);
  if (!user) return null;
  const entitlement = await repos.entitlements.get(userId);
  return { user, entitlement, sessionId: null };
}
