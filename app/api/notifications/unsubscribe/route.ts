import { getRepos } from "@/lib/db/repos";
import { appUrl } from "@/lib/email/templates";
import { resolvePreferences } from "@/lib/notifications/preferences";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unsubscribe from digest emails via the signed link in every digest.
 *
 * GET is the footer link (redirects to Settings with a confirmation);
 * POST is RFC 8058 one-click, which mail clients call without showing a
 * page. Both only turn the email channel off — account and security mail
 * is transactional and unaffected. No session is required: the token is
 * the credential, and the worst a forged-but-valid token could do is stop
 * someone's digest emails.
 */
export async function GET(req: Request) {
  const outcome = await applyUnsubscribe(req);
  const base = appUrl();
  if (outcome === "invalid") {
    return NextResponse.redirect(`${base}/settings/notifications?unsubscribed=invalid`, 303);
  }
  return NextResponse.redirect(`${base}/settings/notifications?unsubscribed=1`, 303);
}

export async function POST(req: Request) {
  const outcome = await applyUnsubscribe(req);
  if (outcome === "invalid") {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, unsubscribed: outcome === "updated" });
}

async function applyUnsubscribe(req: Request): Promise<"updated" | "already" | "invalid"> {
  const token = new URL(req.url).searchParams.get("token");
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return "invalid";
  const repos = getRepos();
  const user = await repos.users.getById(userId);
  if (!user) return "invalid";
  const current = resolvePreferences(await repos.notificationPreferences.get(userId));
  if (current.saved && !current.emailEnabled) return "already";
  const { saved: _s, updatedAt: _u, ...input } = current;
  await repos.notificationPreferences.upsert(userId, { ...input, emailEnabled: false });
  return "updated";
}
