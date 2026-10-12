import { gateAiRequestByIp, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { type Session, getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { answerDecision, dismissDecision } from "@/lib/decisions/actions";
import { confirmCopy } from "@/lib/decisions/copy";
import { type DecisionLinkClaims, verifyDecisionLinkToken } from "@/lib/decisions/links";
import type { DecisionKind } from "@/lib/domain/types";
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
 * GET never changes state. Mail scanners, Safe Links, and unfurlers fetch
 * every URL in a message without a tap, and a digest carries one URL per
 * option: `open` redirects into the inbox, `answer` / `dismiss` serve a
 * one-button page whose form POSTs the token back here. Only the POST
 * resolves the decision.
 *
 * Every outcome of an action redirects into `/decisions` with a `link=`
 * status so the page can say what happened.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const verified = await verifyDecisionLinkToken(token);
  if (!verified.ok) return redirect(`/decisions?link=${verified.reason}`);
  const { claims } = verified;

  const refused = await refuseForeignSession(req, claims);
  if (refused) return refused;

  if (claims.link.action === "open") return redirect(openPath(claims));
  const decision = await getRepos().decisions.get(claims.userId, claims.decisionId);
  return confirmPage(token ?? "", claims, decision?.kind ?? null);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const raw = form?.get("token");
  const verified = await verifyDecisionLinkToken(typeof raw === "string" ? raw : null);
  if (!verified.ok) return redirect(`/decisions?link=${verified.reason}`);
  const { claims } = verified;

  const session = await getSession(req);
  const refused = await refuseForeignSession(req, claims, session);
  if (refused) return refused;

  if (claims.link.action === "open") return redirect(openPath(claims));

  const actor = session ?? (await sessionForLinkUser(claims.userId));
  if (!actor) return redirect("/decisions?link=invalid");

  if (claims.link.action === "dismiss") {
    const result = await dismissDecision({ userId: actor.user.id, decisionId: claims.decisionId });
    if (!result.ok) return redirect(`/decisions?link=${linkFailure(result.reason)}`);
    return redirect(`/decisions?link=${result.execution ? "rejected" : "dismissed"}`);
  }

  // Answering may start a sift when no run is waiting, so it shares the AI
  // routes' per-IP limit; a throttled tap still lands on the inbox page.
  const ipGate = await gateAiRequestByIp(req, "triage");
  if (!ipGate.ok) return redirect("/decisions?link=busy");

  const result = await answerDecision({
    req,
    session: actor,
    decisionId: claims.decisionId,
    answer: { text: null, option: claims.link.option, via: "link" },
    modelPreference: null,
    offline: resolveOfflineMode(req),
  });
  if (!result.ok) return redirect(`/decisions?link=${linkFailure(result.reason)}`);
  return redirect(`/decisions?link=${linkOutcome(result.execution?.mode)}`);
}

/** Query value for the inbox toast after an execution decision taken by link. */
function linkOutcome(mode: string | undefined): string {
  switch (mode) {
    case "approved":
    case "answered":
      return "approved";
    case "accepted":
    case "edited":
      return "done";
    case "rejected":
      return "rejected";
    case "stale":
      return "gone";
    default:
      return "answered";
  }
}

async function refuseForeignSession(
  req: Request,
  claims: DecisionLinkClaims,
  session?: Session | null,
): Promise<NextResponse | null> {
  const current = session === undefined ? await getSession(req) : session;
  if (current && current.user.id !== claims.userId) {
    return NextResponse.json({ error: "This link belongs to another account" }, { status: 403 });
  }
  return null;
}

function openPath(claims: DecisionLinkClaims): string {
  return `/decisions?focus=${encodeURIComponent(claims.decisionId)}`;
}

function linkFailure(reason: "not_found" | "already_resolved" | "invalid_answer"): string {
  if (reason === "already_resolved") return "used";
  // A link minted for an option a memory proposal does not take: treat as invalid.
  if (reason === "invalid_answer") return "invalid";
  return "gone";
}

function redirect(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getSiteUrl()), 303);
}

/**
 * The confirmation step between a tap and the action: one button, no
 * script, styled inline so it renders in any webview. The token travels in
 * the form body, never in a URL a scanner could follow.
 */
function confirmPage(
  token: string,
  claims: DecisionLinkClaims,
  kind: DecisionKind | null,
): NextResponse {
  const link = claims.link;
  const { label, question } = confirmCopy(link, kind);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(label)} — Sifty</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #f7f7f4; color: #26251e; }
  main { max-width: 420px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 20px; font-weight: 500; margin: 0 0 8px; }
  p { margin: 0 0 24px; color: rgba(38, 37, 30, 0.6); }
  button { font: inherit; font-weight: 500; padding: 12px 20px; border-radius: 10px; border: 0; background: #f54e00; color: #fff; cursor: pointer; }
  a { display: inline-block; margin-top: 16px; color: rgba(38, 37, 30, 0.6); }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(label)}</h1>
  <p>${escapeHtml(question)}</p>
  <form method="post" action="/api/decisions/link">
    <input type="hidden" name="token" value="${escapeHtml(token)}">
    <button type="submit">${escapeHtml(label)}</button>
  </form>
  <a href="${escapeHtml(openPath(claims))}">Open in Sifty instead</a>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
