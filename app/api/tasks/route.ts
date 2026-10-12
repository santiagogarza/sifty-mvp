import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { enqueueSift, wantsSift } from "@/lib/ai/sift/enqueue";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { IdConflictError } from "@/lib/db/repos/types";
import { TASK_LIMITS } from "@/lib/domain/limits";
import { ClientId, TaskPatchSchema } from "@/lib/domain/task-patch-schema";
import { TASK_EDITABLE_FIELDS, type Task } from "@/lib/domain/types";
import { spawnNextInstance } from "@/lib/recurrence/spawn";
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
 *
 * A recurring task that arrives already done spawns its successor
 * (`spawned`); when it still owed a sift, the successor gets it and the
 * `sift` summary describes that run.
 */
const CreateBody = TaskPatchSchema.extend({
  id: ClientId.optional(),
  sourceText: z.string().min(1).max(TASK_LIMITS.sourceText),
  createdAt: z.string().datetime().optional(),
  /** Settings → AI model preference; unknown values fall back to the stage default. */
  modelPreference: z.string().min(1).max(64).optional(),
});

/**
 * Fields the sift writes. A replayed create (same id, after a lost 201)
 * carries the client's un-sifted capture, so these only come through when
 * the user explicitly edited them (`editedFields`).
 */
const SIFT_OWNED_FIELDS = [
  ...TASK_EDITABLE_FIELDS,
  "aiStatus",
  "aiError",
  "aiAttempts",
  "confidence",
  "clarifyingQuestion",
  "rationale",
] as const;

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const {
    id,
    sourceText,
    sourceContext,
    createdAt,
    editedFields,
    modelPreference,
    completedOn,
    timeZone,
    ...enrichment
  } = parsed.data;
  const repos = getRepos();
  const userId = session.user.id;
  try {
    // A replayed create (same id) must not write the stale capture over a
    // sift the server already ran or is running.
    const existing = id ? await repos.tasks.get(userId, id) : null;
    if (existing?.siftId) {
      for (const key of SIFT_OWNED_FIELDS) {
        if (!editedFields?.includes(key as (typeof TASK_EDITABLE_FIELDS)[number])) {
          enrichment[key] = undefined;
        }
      }
      // The triage stage routes inbox tasks to waiting/someday. A replay
      // still carrying the capture default must not undo that; a move the
      // user made (any other lifecycle) is not in `editedFields` and must
      // still land.
      if (enrichment.lifecycle === "inbox") enrichment.lifecycle = undefined;
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

    const sift_ = async (target: Task): Promise<{ task: Task; sift: SiftSummary }> => {
      const result = await enqueueSift({
        req,
        session,
        task: target,
        modelPreference: modelPreference ?? null,
        offline: resolveOfflineMode(req),
        // /api/triage applies the per-IP limit before parsing; capture is
        // the default sifting path, so it applies the same limit here.
        checkIp: true,
      });
      const summary: SiftSummary = result.ok
        ? { enqueued: true, siftId: result.siftId, runId: result.runId }
        : result.reason === "denied"
          ? { enqueued: false, reason: "denied", code: String(result.admission.body.code ?? "") }
          : { enqueued: false, reason: result.reason };
      return { task: result.task, sift: summary };
    };

    let sift: SiftSummary = { enqueued: false, reason: "not_wanted" };
    let spawned: Task | null = null;

    // A recurring task that arrives already completed (captured and done
    // offline, or a PATCH that 404'd and fell back to create) still owes
    // its series the next instance. Idempotent, like the PATCH path. The
    // sift, if one is still owed, goes to the live successor: spending it
    // on the finished row would organize nothing the user will look at.
    const completedRecurring = task.lifecycle === "done" && !!task.recurrence;
    if (completedRecurring) {
      const owesSift = !task.siftId && wantsSift(task);
      if (owesSift) {
        task = (await repos.tasks.update(userId, task.id, { aiStatus: "idle" })) ?? task;
      }
      const next = await spawnNextInstance(repos, userId, {
        parent: task,
        previousLifecycle: "active",
        completedOn,
        timeZone,
      });
      spawned = next?.task ?? null;
      if (spawned && next?.created && owesSift && !spawned.siftId) {
        const sifted = await sift_(spawned);
        spawned = sifted.task;
        sift = sifted.sift;
      }
    } else if (!task.siftId && wantsSift(task)) {
      // `task.siftId` is read after create/update; a concurrent duplicate
      // that also sees null loses the atomic claim inside `enqueueSift`.
      const sifted = await sift_(task);
      task = sifted.task;
      sift = sifted.sift;
    } else if (task.siftId) {
      sift = { enqueued: false, reason: "already_sifting" };
    }

    return NextResponse.json({ task, sift, spawned }, { status: 201 });
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
