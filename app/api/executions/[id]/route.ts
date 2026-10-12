import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** One execution with its step log; what the task sheet polls while it runs. */
export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const repos = getRepos();
  const execution = await repos.executions.get(session.user.id, id);
  if (!execution) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const steps = await repos.executions.listSteps(session.user.id, id, { limit: 100 });
  return NextResponse.json({ execution, steps });
}
