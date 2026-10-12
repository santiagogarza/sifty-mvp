import type { Session } from "@/lib/auth/session";
import { type Repos, getRepos } from "@/lib/db/repos";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import type { Task } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { startWorkflow } from "@/lib/workflows/dispatch";
import { siftTask } from "@/lib/workflows/sift-task";
import { type AiAdmission, admitAiRun } from "../ai-gate";
import type { SiftInput } from "./execute-stage";
import { SIFT_PROMPT_VERSION } from "./stages";

/**
 * Accept a sift and hand it to the workflow.
 *
 * Order matters:
 *
 * 1. The cap gate runs first (`admitAiRun`): rate limits, the `ai_runs`
 *    window, and the tier's `siftsPerDay`.
 * 2. The `sift` accounting row is written *before* `start()`, so the next
 *    request already sees this sift in today's count. Without it a burst of
 *    captures would all pass the gate before any stage row lands.
 * 3. The task takes the new `siftId` (superseding any sift still running)
 *    and goes `pending`.
 * 4. `start()`; if the runtime refuses, the accounting row flips to
 *    `failed` and the task shows a retryable error instead of hanging.
 */

export type EnqueueResult =
  | { ok: true; task: Task; siftId: string; runId: string }
  | { ok: false; reason: "denied"; admission: Extract<AiAdmission, { ok: false }>; task: Task }
  | { ok: false; reason: "not_started"; task: Task };

export const SIFT_NOT_STARTED_MESSAGE = "Sifting could not start — try again.";

export async function enqueueSift(args: {
  req: Request;
  session: Session;
  task: Task;
  modelPreference: string | null;
  offline: boolean;
  /** Rate-limit bucket; "triage" for both capture and re-sift. */
  bucket?: string;
}): Promise<EnqueueResult> {
  const repos = getRepos();
  const { session, task } = args;
  const userId = session.user.id;

  const admission = await admitAiRun({
    req: args.req,
    session,
    bucket: args.bucket ?? "triage",
  });
  if (!admission.ok) {
    // The task exists either way; the denial is recorded on it so the UI
    // can show the cap message and offer the upgrade path.
    const denied =
      (await repos.tasks.update(userId, task.id, {
        aiStatus: "failed",
        aiError: String(admission.body.error ?? "Sifting is not available right now."),
        siftStage: null,
      })) ?? task;
    return { ok: false, reason: "denied", admission, task: denied };
  }

  const siftId = makeId("sift");
  const accounting = await repos.aiRuns.insert({
    userId,
    taskId: task.id,
    promptVersion: SIFT_PROMPT_VERSION,
    stage: SIFT_ACCOUNTING_STAGE,
    siftId,
    model: "sifty.workflow",
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline: args.offline,
    error: null,
  });

  const pending =
    (await repos.tasks.update(userId, task.id, {
      aiStatus: "pending",
      aiError: null,
      siftId,
      siftStage: null,
    })) ?? task;

  const input: SiftInput = {
    userId,
    taskId: task.id,
    siftId,
    accountingRunId: accounting.id,
    modelPreference: args.modelPreference,
    offline: args.offline,
  };

  try {
    const { runId } = await startWorkflow(siftTask, [input]);
    return { ok: true, task: pending, siftId, runId };
  } catch (err) {
    reportError(err, { area: "sift.enqueue", userId, tags: { taskId: task.id, siftId } });
    return { ok: false, reason: "not_started", task: await abandon(repos, input) };
  }
}

async function abandon(repos: Repos, input: SiftInput): Promise<Task> {
  const message = SIFT_NOT_STARTED_MESSAGE;
  await repos.aiRuns.setStatus(input.userId, input.accountingRunId, "failed", message);
  const task = await repos.tasks.update(input.userId, input.taskId, {
    aiStatus: "failed",
    aiError: message,
  });
  if (!task) throw new Error("task vanished while abandoning its sift");
  return task;
}

/**
 * Whether a freshly created task wants sifting. Replays of offline-captured
 * tasks that were already organized (`ready`) or deliberately left alone
 * (`idle`) must not burn a sift.
 */
export function wantsSift(task: Pick<Task, "aiStatus">): boolean {
  return task.aiStatus === "pending" || task.aiStatus === "running" || task.aiStatus === "failed";
}
