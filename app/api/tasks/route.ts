import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { enqueueSift, wantsSift } from "@/lib/ai/sift/enqueue";
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
 * enrichment fields for replaying tasks that were captured offline.
 * Creating the same id twice is idempotent.
 *
 * A new task that still wants organizing (`aiStatus` pending) is handed to
 * the `siftTask` workflow here, server-side, so sifting no longer depends on
 * the tab staying open. The response carries the task in its post-enqueue
 * state (`pending`, or `failed` with the cap message when the tier's daily
 * sifts are used up) plus a `sift` summary; the client polls
 * `GET /api/tasks/:id` for stage progress.
 */
const CreateBody = TaskPatchSchema.extend({
  id: ClientId.optional(),
  sourceText: z.string().min(1).max(TASK_LIMITS.sourceText),
  createdAt: z.string().datetime().optional(),
  /** Settings → AI model preference; unknown values fall back to the stage default. */
  modelPreference: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { id, sourceText, sourceContext, createdAt, editedFields, modelPreference, ...enrichment } =
    parsed.data;
  const repos = getRepos();
  const userId = session.user.id;
  try {
    // A replayed create (same id) must not reset a sift the server already
    // owns: the client's `aiStatus: "pending"` is stale by then.
    const existing = id ? await repos.tasks.get(userId, id) : null;
    if (existing?.siftId) {
      enrichment.aiStatus = undefined;
      enrichment.aiError = undefined;
      enrichment.aiAttempts = undefined;
    }

    let task = await repos.tasks.create(userId, {
      id,
      sourceText,
      sourceContext: sourceContext ?? null,
      createdAt,
    });
    const patch = Object.fromEntries(
      Object.entries(enrichment).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(patch).length > 0 || editedFields?.length) {
      task = (await repos.tasks.update(userId, task.id, patch, { editedFields })) ?? task;
    }

    let sift: SiftSummary = { enqueued: false, reason: "not_wanted" };
    if (!existing?.siftId && wantsSift(task)) {
      const result = await enqueueSift({
        req,
        session,
        task,
        modelPreference: modelPreference ?? null,
        offline: resolveOfflineMode(req),
      });
      task = result.task;
      sift = result.ok
        ? { enqueued: true, siftId: result.siftId, runId: result.runId }
        : result.reason === "denied"
          ? { enqueued: false, reason: "denied", code: String(result.admission.body.code ?? "") }
          : { enqueued: false, reason: "not_started" };
    } else if (existing?.siftId) {
      sift = { enqueued: false, reason: "already_sifting" };
    }

    return NextResponse.json({ task, sift }, { status: 201 });
  } catch (err) {
    if (err instanceof IdConflictError) {
      return NextResponse.json({ error: "Task id is not available" }, { status: 409 });
    }
    throw err;
  }
}

type SiftSummary =
  | { enqueued: true; siftId: string; runId: string }
  | { enqueued: false; reason: "not_wanted" | "already_sifting" | "not_started" }
  | { enqueued: false; reason: "denied"; code: string };
