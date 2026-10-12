import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { editTouchesSignalField, maybeExtractFromEdit } from "@/lib/ai/memory/edit-trigger";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { expireOpenDecisionsForTask } from "@/lib/decisions/service";
import { TaskPatchSchema } from "@/lib/domain/task-patch-schema";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The sift poller reads this. `labels` carries the task's labels so a
 * client that has never seen a label the enrich stage just created can
 * render it without a second round trip.
 */
export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const repos = getRepos();
  const task = await repos.tasks.get(session.user.id, id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const labels = await repos.labels.listByIds(session.user.id, task.labelIds);
  return NextResponse.json({ task, labels });
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = TaskPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { editedFields, ...patch } = parsed.data;
  const repos = getRepos();
  // Only an edit to a priority/effort/date/delegation/label field can
  // contradict the sift; everything else skips the extra read.
  const before = editTouchesSignalField(editedFields)
    ? await repos.tasks.get(session.user.id, id)
    : null;
  const task = await repos.tasks.update(session.user.id, id, patch, { editedFields });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (before) {
    await maybeExtractFromEdit(repos, {
      req,
      session,
      before,
      patch,
      editedFields,
      offline: resolveOfflineMode(req),
    });
  }
  return NextResponse.json({ task });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const repos = getRepos();
  // A sift suspended on a question about this task must be released
  // before the cascade removes the decision it is waiting on.
  await expireOpenDecisionsForTask(repos, session.user.id, id);
  const ok = await repos.tasks.delete(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
