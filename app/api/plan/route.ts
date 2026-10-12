import { publicPlan } from "@/lib/ai/plan/public";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { deriveEntitlement } from "@/lib/entitlements/entitlements";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's latest daily plan — what the Today page shows above the list
 * ("Planned at 04:12 · 3 moves") and polls while a re-plan runs. Also
 * says whether this account may ask for one (`canReplan`), so the button
 * only appears where it works.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const repos = getRepos();
  const [plan, running] = await Promise.all([
    repos.dailyPlans.latest(session.user.id),
    repos.dailyPlans.runningFor(session.user.id),
  ]);
  const entitlement = deriveEntitlement({ profile: session.user, snapshot: session.entitlement });
  return NextResponse.json({
    plan: plan ? publicPlan(plan) : null,
    running: !!running,
    canReplan: entitlement.caps.dailyPlan,
  });
}
