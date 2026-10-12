import { enqueueNightlyPlans } from "@/lib/ai/plan/enqueue";
import { getRepos } from "@/lib/db/repos";
import { demoFlagEnabled } from "@/lib/env/production-guards";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron entry: enqueue tonight's `dailyPlan` for every eligible account.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; the
 * route refuses to run without the secret configured so it can never be a
 * public trigger. Reruns are no-ops: the `daily_plans` claim admits one
 * cron plan per user and local day.
 *
 * Schedule in `vercel.json`:
 *   Hobby (daily crons only): { "path": "/api/cron/daily-plan", "schedule": "0 4 * * *" }
 *     04:00 UTC is night across the Americas and early morning in Europe,
 *     and two hours before the morning-plan digest tick, so the email
 *     describes the re-ranked list. Zones east of UTC+8 plan mid-day.
 *   Pro: hourly, so every zone plans in its own small hours.
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
  const result = await enqueueNightlyPlans(getRepos(), {
    offline: demoFlagEnabled("SIFTY_AI_OFFLINE"),
  });
  return NextResponse.json({ ok: result.failed === 0 && !result.truncated, ...result });
}
