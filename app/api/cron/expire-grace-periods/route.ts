import { expireGracePeriods } from "@/lib/billing/grace";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron entry: close dunning grace periods that ran out.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. The
 * route refuses to run without the secret configured so it can never be a
 * public trigger. Schedule it in `vercel.json`:
 *
 *   { "path": "/api/cron/expire-grace-periods", "schedule": "0 6 * * *" }
 *
 * Daily is enough: readers already resolve an expired grace to `free` on
 * their own; this only persists the drop.
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
  const result = await expireGracePeriods(getRepos());
  return NextResponse.json({
    ok: result.failed.length === 0,
    expired: result.expired.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  });
}
