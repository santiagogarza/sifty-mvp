import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { TaskPatchSchema } from "@/lib/domain/task-patch-schema";
import type { Task } from "@/lib/domain/types";
import { completeRecurring } from "@/lib/recurrence/complete";
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

/**
 * Narrow update. Completing a recurring task also spawns its next instance
 * (`spawnNextInstance`, idempotent) and returns it as `spawned` so the
 * client can show it without waiting for the next pull; `spawned` is null
 * otherwise.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = TaskPatchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { editedFields, completedOn, timeZone, ...patch } = parsed.data;
  const repos = getRepos();
  const userId = session.user.id;
  const completing = patch.lifecycle === "done";
  const before = completing ? await repos.tasks.get(userId, id) : null;
  let task = await repos.tasks.update(userId, id, patch, { editedFields });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let spawned: Task | null = null;
  if (completing && task.recurrence) {
    const completed = await completeRecurring(repos, {
      req,
      session,
      task,
      previousLifecycle: before?.lifecycle ?? "active",
      completedOn,
      timeZone,
    });
    task = completed.task;
    spawned = completed.spawned;
  }
  return NextResponse.json({ task, spawned });
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ok = await getRepos().tasks.delete(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
