import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { PreferencesSchema, resolvePreferences } from "@/lib/notifications/preferences";
import { isPushConfigured } from "@/lib/notifications/push";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Notification preferences for the signed-in user.
 *
 * GET returns the saved row or the defaults (with `saved: false`), plus
 * whether push is configured server-side and how many push subscriptions
 * the account has. PUT replaces the whole preference set; partial updates
 * are the client's job, which keeps the row internally consistent (quiet
 * hours come as a pair).
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const repos = getRepos();
  const [row, subscriptions, recent] = await Promise.all([
    repos.notificationPreferences.get(session.user.id),
    repos.pushSubscriptions.listForUser(session.user.id),
    repos.notificationSends.listForUser(session.user.id, 5),
  ]);
  return NextResponse.json({
    preferences: resolvePreferences(row),
    pushConfigured: isPushConfigured(),
    pushSubscriptions: subscriptions.map((s) => ({
      id: s.id,
      endpoint: s.endpoint,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    })),
    recentSends: recent.map((s) => ({
      kind: s.kind,
      channel: s.channel,
      periodKey: s.periodKey,
      status: s.status,
      sentAt: s.sentAt,
    })),
  });
}

export async function PUT(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = PreferencesSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid input" },
      { status: 400 },
    );
  }
  const saved = await getRepos().notificationPreferences.upsert(session.user.id, parsed.data);
  return NextResponse.json({ preferences: resolvePreferences(saved) });
}
