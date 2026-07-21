import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { IdConflictError } from "@/lib/db/repos/types";
import { TASK_LIMITS } from "@/lib/domain/limits";
import { ClientId, TaskPatchSchema } from "@/lib/domain/task-patch-schema";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const tasks = await getRepos().tasks.list(session.user.id);
  return NextResponse.json({ tasks });
}

/**
 * Create accepts the client-generated id (optimistic sync) plus optional
 * enrichment fields for replaying tasks that were captured offline and
 * already triaged locally. Creating the same id twice is idempotent.
 */
const CreateBody = TaskPatchSchema.extend({
  id: ClientId.optional(),
  sourceText: z.string().min(1).max(TASK_LIMITS.sourceText),
  createdAt: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { id, sourceText, sourceContext, createdAt, editedFields, ...enrichment } = parsed.data;
  const repos = getRepos();
  try {
    let task = await repos.tasks.create(session.user.id, {
      id,
      sourceText,
      sourceContext: sourceContext ?? null,
      createdAt,
    });
    if (Object.keys(enrichment).length > 0 || editedFields?.length) {
      task =
        (await repos.tasks.update(session.user.id, task.id, enrichment, { editedFields })) ?? task;
    }
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof IdConflictError) {
      return NextResponse.json({ error: "Task id is not available" }, { status: 409 });
    }
    throw err;
  }
}
