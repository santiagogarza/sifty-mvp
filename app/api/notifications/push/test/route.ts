import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { appUrl } from "@/lib/email/templates";
import { isPushConfigured, sendPushToUser } from "@/lib/notifications/push";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send a test notification to every device the signed-in user registered. */
export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push notifications are not configured on this server." },
      { status: 503 },
    );
  }
  const result = await sendPushToUser(getRepos(), session.user.id, {
    title: "Sifty notifications are on",
    body: "This is what a reminder looks like. Tap to open Today.",
    url: `${appUrl()}/today`,
    tag: "sifty-test",
  });
  if (result.status === "no_subscriptions") {
    return NextResponse.json({ error: "This account has no push subscriptions." }, { status: 404 });
  }
  if (result.status === "not_configured") {
    return NextResponse.json({ error: "Push is not configured." }, { status: 503 });
  }
  return NextResponse.json({ ok: result.delivered > 0, ...result });
}
