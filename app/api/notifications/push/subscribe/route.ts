import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from "@/lib/db/repos/types";
import { isPushConfigured } from "@/lib/notifications/push";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The browser's `PushSubscription.toJSON()`. */
const SubscriptionBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const UnsubscribeBody = z.object({ endpoint: z.string().url().max(2048) });

/** Register (or refresh) this browser's push subscription for the signed-in user. */
export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push notifications are not configured on this server." },
      { status: 503 },
    );
  }
  const parsed = SubscriptionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  if (!parsed.data.endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "Push endpoints must be https" }, { status: 400 });
  }
  const repos = getRepos();
  const existing = await repos.pushSubscriptions.listForUser(session.user.id);
  if (
    existing.length >= MAX_PUSH_SUBSCRIPTIONS_PER_USER &&
    !existing.some((s) => s.endpoint === parsed.data.endpoint)
  ) {
    return NextResponse.json(
      { error: "Too many devices. Turn notifications off on one you no longer use." },
      { status: 409 },
    );
  }
  const saved = await repos.pushSubscriptions.upsert(session.user.id, {
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
  });
  return NextResponse.json({ ok: true, id: saved.id });
}

/** Forget this browser's subscription. Idempotent. */
export async function DELETE(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = UnsubscribeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const removed = await getRepos().pushSubscriptions.deleteByEndpoint(
    session.user.id,
    parsed.data.endpoint,
  );
  return NextResponse.json({ ok: true, removed });
}
