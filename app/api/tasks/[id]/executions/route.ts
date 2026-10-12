import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { listTaskExecutions } from "@/lib/executions/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Executions of one task, newest first, with the step log of the newest. */
export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const repos = getRepos();
  const task = await repos.tasks.get(session.user.id, id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const executions = await listTaskExecutions(repos, session.user.id, id);
  const latest = executions[0];
  const steps = latest
    ? await repos.executions.listSteps(session.user.id, latest.id, { limit: 100 })
    : [];
  return NextResponse.json({ executions, steps });
}
