import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { type EnqueueResult, enqueueSift } from "@/lib/ai/sift/enqueue";
import type { Session } from "@/lib/auth/session";
import type { Repos } from "@/lib/db/repos";
import { expireOpenDecisionsForTask } from "@/lib/decisions/service";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { spawnNextInstance } from "./spawn";

/**
 * Everything completing a recurring task owes its series, shared by the
 * PATCH (list / sheet complete) and POST (offline capture, PATCH→404
 * fallback) routes:
 *
 * 1. If the finished instance still owes a sift — pending, a run in
 *    flight, or a run suspended on a clarifying question — the question is
 *    expired, the run is superseded on the parent (its next step sees the
 *    changed `siftId` and stops) and the parent settles as `idle`.
 *    Organizing a finished row would organize nothing the user will read,
 *    and an answer must never land on it.
 * 2. The next instance is spawned (idempotent; see `spawnNextInstance`),
 *    `pending` when a sift is owed.
 * 3. A `pending` successor without a run is enqueued — on this call or on
 *    a retry of it, so a failed enqueue never strands the live instance.
 */
export type SiftSummary =
  | { enqueued: true; siftId: string; runId: string }
  | { enqueued: false; reason: "not_wanted" | "already_sifting" | "not_started" }
  | { enqueued: false; reason: "denied"; code: string };

export function summarizeEnqueue(result: EnqueueResult): SiftSummary {
  if (result.ok) return { enqueued: true, siftId: result.siftId, runId: result.runId };
  if (result.reason === "denied") {
    return { enqueued: false, reason: "denied", code: String(result.admission.body.code ?? "") };
  }
  return { enqueued: false, reason: result.reason };
}

/** A task carries at most one open question per sift; headroom, not a target. */
const OPEN_DECISIONS_PER_TASK = 10;

export async function completeRecurring(
  repos: Repos,
  args: {
    req: Request;
    session: Session;
    /** The instance just completed (post-update row), with a rule. */
    task: Task;
    previousLifecycle: Lifecycle;
    completedOn?: string | null;
    timeZone?: string | null;
    modelPreference?: string | null;
  },
): Promise<{ task: Task; spawned: Task | null; sift: SiftSummary | null }> {
  const userId = args.session.user.id;
  let parent = args.task;

  const openQuestions = await repos.decisions.listOpenForTask(userId, parent.id, {
    limit: OPEN_DECISIONS_PER_TASK,
  });
  const inFlight = parent.aiStatus === "pending" || parent.aiStatus === "running";
  const owesSift = inFlight || openQuestions.length > 0;

  if (owesSift) {
    if (openQuestions.length > 0) await expireOpenDecisionsForTask(repos, userId, parent.id);
    parent =
      (await repos.tasks.update(
        userId,
        parent.id,
        {
          aiStatus: "idle",
          aiError: null,
          siftId: null,
          siftStage: null,
          clarifyingQuestion: null,
        },
        { ifSiftId: parent.siftId },
      )) ??
      (await repos.tasks.get(userId, parent.id)) ??
      parent;
  }

  const next = await spawnNextInstance(repos, userId, {
    parent,
    previousLifecycle: args.previousLifecycle,
    completedOn: args.completedOn,
    timeZone: args.timeZone,
    needsSift: owesSift,
  });
  let spawned = next?.task ?? null;
  let sift: SiftSummary | null = null;

  // Never enqueued (`pending`, no run) or its run died (`failed`): enqueue.
  // A `running` successor is left alone — this may be a replay.
  if (
    spawned &&
    ((spawned.aiStatus === "pending" && !spawned.siftId) || spawned.aiStatus === "failed")
  ) {
    const result = await enqueueSift({
      req: args.req,
      session: args.session,
      task: spawned,
      modelPreference: args.modelPreference ?? null,
      offline: resolveOfflineMode(args.req),
      checkIp: true,
    });
    spawned = result.task;
    sift = summarizeEnqueue(result);
  }

  return { task: parent, spawned, sift };
}
