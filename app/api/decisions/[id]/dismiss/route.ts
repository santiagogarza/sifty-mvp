import { getSession } from "@/lib/auth/session";
import { dismissDecision } from "@/lib/decisions/actions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Dismiss a decision: Sifty keeps its own assumptions and the task is
 * marked accordingly. 409 when it was already resolved.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const result = await dismissDecision({ userId: session.user.id, decisionId: id });
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Already resolved", decision: result.decision },
      { status: 409 },
    );
  }
  return NextResponse.json({ decision: result.decision, task: result.task });
}
