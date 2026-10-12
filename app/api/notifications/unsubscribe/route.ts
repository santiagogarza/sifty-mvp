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
 * GET only validates the token and shows a one-button confirmation:
 * link scanners and prefetchers follow footer links, so a GET must never
 * change anything. POST does the work — either the confirmation form
 * (`confirm=1`, redirects to Settings) or RFC 8058 one-click, which mail
 * clients send without showing a page (JSON reply). Both only turn the
 * email channel off; account and security mail is transactional and
 * unaffected. No session is required: the token is the credential, and
 * the worst a leaked token can do is stop someone's digest emails.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const base = appUrl();
  const userId = await resolveUser(token);
  if (!userId) {
    return NextResponse.redirect(`${base}/settings/notifications?unsubscribed=invalid`, 303);
  }
  const action = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(token ?? "")}`;
  return new NextResponse(confirmationPage(action, `${base}/settings/notifications`), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const form = await readForm(req);
  const outcome = await applyUnsubscribe(token);
  const base = appUrl();
  if (form.get("confirm") === "1") {
    const flag = outcome === "invalid" ? "invalid" : "1";
    return NextResponse.redirect(`${base}/settings/notifications?unsubscribed=${flag}`, 303);
  }
  if (outcome === "invalid") {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, unsubscribed: outcome === "updated" });
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/x-www-form-urlencoded")) return new URLSearchParams();
  const text = await req.text().catch(() => "");
  return new URLSearchParams(text);
}

async function resolveUser(token: string | null): Promise<string | null> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return null;
  const user = await getRepos().users.getById(userId);
  return user ? userId : null;
}

async function applyUnsubscribe(token: string | null): Promise<"updated" | "already" | "invalid"> {
  const userId = await resolveUser(token);
  if (!userId) return "invalid";
  const repos = getRepos();
  const current = resolvePreferences(await repos.notificationPreferences.get(userId));
  if (current.saved && !current.emailEnabled) return "already";
  const { saved: _s, updatedAt: _u, ...input } = current;
  await repos.notificationPreferences.upsert(userId, { ...input, emailEnabled: false });
  return "updated";
}

/** Minimal, self-contained page: no app chrome, works signed out, one action. */
function confirmationPage(action: string, settingsUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Unsubscribe from Sifty digests</title>
<style>
body{margin:0;padding:48px 16px;background:#f7f6f3;color:#1c1b18;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:460px;margin:0 auto;background:#fff;border:1px solid #e6e3dd;border-radius:12px;padding:32px 36px}
h1{font-size:20px;margin:16px 0 8px}p{margin:0 0 14px;color:#6b6660}
button{background:#c2410c;color:#fff;border:0;border-radius:8px;padding:11px 18px;font:600 14px inherit;cursor:pointer}
a{color:#c2410c}
</style></head>
<body><main>
<strong>Sifty</strong>
<h1>Stop digest emails?</h1>
<p>You will no longer get the morning plan, due reminders, or the weekly review by email. Account and security emails still arrive. You can turn this back on any time in <a href="${settingsUrl}">Settings → Notifications</a>.</p>
<form method="post" action="${action}"><input type="hidden" name="confirm" value="1"><button type="submit">Unsubscribe</button></form>
</main></body></html>`;
}
