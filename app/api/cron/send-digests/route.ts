import { getRepos } from "@/lib/db/repos";
import { sendDueDigests } from "@/lib/notifications/send-digests";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron entry: send every digest that is due this hour.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; the
 * route refuses to run without the secret configured so it can never be
 * a public trigger. Safe to call as often as you like — the send ledger
 * makes reruns no-ops.
 *
 * Schedule in `vercel.json`:
 *   Hobby (daily crons only): { "path": "/api/cron/send-digests", "schedule": "0 6 * * *" }
 *     One tick a day at 06:00 UTC, so only morning plans in zones whose
 *     send hour falls within MAX_LATE_HOURS of it go out (Europe at 7–8
 *     am local, both sides of DST). Afternoon reminders need hourly.
 *   Pro:                       { "path": "/api/cron/send-digests", "schedule": "0 * * * *" }
 *     Every hour; each user is served at their own local send hour.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured. Set it before scheduling this job." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendDueDigests(getRepos());
  return NextResponse.json({ ok: result.failed === 0, ...result });
}
