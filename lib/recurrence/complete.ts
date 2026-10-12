import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { type EnqueueResult, enqueueSift } from "@/lib/ai/sift/enqueue";
import type { Session } from "@/lib/auth/session";
import type { Repos } from "@/lib/db/repos";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { spawnNextInstance } from "./spawn";

/**
 * Everything completing a recurring task owes its series, shared by the
 * PATCH (list / sheet complete) and POST (offline capture, PATCH→404
 * fallback) routes:
 *
 * 1. If the finished instance still owes a sift — pending, or a run in
 *    flight — the run is superseded on the parent (its next step sees the
 *    changed `siftId` and stops) and the parent settles as `idle`.
 *    Organizing a finished row would organize nothing the user will read.
 * 2. The next instance is spawned (idempotent; see `spawnNextInstance`).
 * 3. The owed sift, if any, is enqueued on the freshly created successor,
 *    so the live instance is the one that gets organized.
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
  const owesSift = parent.aiStatus === "pending" || parent.aiStatus === "running";

  if (owesSift) {
    parent =
      (await repos.tasks.update(
        userId,
        parent.id,
        { aiStatus: "idle", aiError: null, siftId: null, siftStage: null },
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
  });
  let spawned = next?.task ?? null;
  let sift: SiftSummary | null = null;

  if (spawned && next?.created && owesSift && !spawned.siftId) {
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
