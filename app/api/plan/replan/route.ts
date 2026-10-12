import { gateAiRequestByIp, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { enqueueDailyPlan } from "@/lib/ai/plan/enqueue";
import { publicPlan } from "@/lib/ai/plan/public";
import { isValidTimeZone } from "@/lib/ai/plan/timezone";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { TRIAGE_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Re-plan today" (Pro and creator).
 *
 * Starts a `dailyPlan` run for the user's local today and answers 202 with
 * the claimed plan; progress is read from `GET /api/plan`. One plan is
 * billed like one sift. The browser sends its IANA zone so "today" is the
 * user's day even before notification preferences exist.
 */
const Body = z.object({
  timeZone: z.string().min(1).max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
  modelPreference: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const ipGate = await gateAiRequestByIp(req, "plan");
  if (!ipGate.ok) return ipGate.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = await enforceRateLimit(req, {
    route: "plan",
    subject: { id: session.user.id, policy: TRIAGE_POLICY },
    message: "Too many AI requests. Slow down a bit.",
  });
  if (!limit.ok) return limit.response;

  const result = await enqueueDailyPlan({
    repos: getRepos(),
    user: session.user,
    snapshot: session.entitlement,
    trigger: "manual",
    timeZone: parsed.data.timeZone,
    modelPreference: parsed.data.modelPreference ?? null,
    offline: resolveOfflineMode(req),
  });

  if (result.ok) {
    return NextResponse.json(
      { plan: publicPlan(result.plan), runId: result.runId },
      { status: 202 },
    );
  }
  switch (result.reason) {
    case "not_entitled":
      return NextResponse.json(
        {
          error: "Daily planning is part of Sifty Pro. Upgrade to have Sifty plan your day.",
          code: "pro_feature",
        },
        { status: 402 },
      );
    case "cap":
      return NextResponse.json(
        { error: result.admission.reason, code: result.admission.code },
        { status: 402 },
      );
    case "already_running":
      return NextResponse.json(
        { error: "A plan is already running.", plan: publicPlan(result.plan) },
        { status: 409 },
      );
    case "already_planned":
      return NextResponse.json({ error: "Already planned today." }, { status: 409 });
    case "not_started":
      return NextResponse.json(
        { error: "Planning could not start — try again.", plan: publicPlan(result.plan) },
        { status: 503 },
      );
  }
}
