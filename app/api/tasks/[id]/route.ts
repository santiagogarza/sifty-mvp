import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { editTouchesSignalField, maybeExtractFromEdit } from "@/lib/ai/memory/edit-trigger";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { expireOpenDecisionsForTask } from "@/lib/decisions/service";
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
  const { editedFields, completedOn, timeZone, completedFrom, ...patch } = parsed.data;
  const repos = getRepos();
  const userId = session.user.id;
  const completing = patch.lifecycle === "done";
  // The pre-write row is needed to place a recurring successor, and when an
  // edit to a priority/effort/date/delegation/label field may contradict the
  // sift (memory extraction); everything else skips the extra read.
  const before =
    completing || editTouchesSignalField(editedFields) ? await repos.tasks.get(userId, id) : null;
  let task = await repos.tasks.update(userId, id, patch, { editedFields });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (before && editTouchesSignalField(editedFields)) {
    await maybeExtractFromEdit(repos, {
      req,
      session,
      before,
      patch,
      editedFields,
      offline: resolveOfflineMode(req),
    });
  }

  let spawned: Task | null = null;
  if (completing && task.recurrence) {
    // Where the next instance lands: what the client saw before it
    // completed the task, else the row as it was before this write. A
    // retry after a crashed spawn sees the row already done; the Inbox is
    // the review gate, so a misplaced instance gets looked at.
    const previousLifecycle =
      completedFrom ??
      (before && before.lifecycle !== "done" && before.lifecycle !== "dropped"
        ? before.lifecycle
        : "inbox");
    const completed = await completeRecurring(repos, {
      req,
      session,
      task,
      previousLifecycle,
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

  const repos = getRepos();
  // A sift suspended on a question about this task must be released
  // before the cascade removes the decision it is waiting on.
  await expireOpenDecisionsForTask(repos, session.user.id, id);
  const ok = await repos.tasks.delete(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
