import { getSession } from "@/lib/auth/session";
import { cancelExecution } from "@/lib/executions/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Stop an execution. Parked or queued: cancelled at once. Running: the
 * run stops at its next checkpoint (`immediate: false`). 409 when it had
 * already finished.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const result = await cancelExecution({ userId: session.user.id, executionId: id });
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Already finished", execution: result.execution },
      { status: 409 },
    );
  }
  return NextResponse.json({ execution: result.execution, immediate: result.immediate });
}
