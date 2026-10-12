import type { Session } from "@/lib/auth/session";
import { type Repos, getRepos } from "@/lib/db/repos";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { expireOpenDecisionsForTask } from "@/lib/decisions/service";
import type { Task } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { startWorkflow } from "@/lib/workflows/dispatch";
import { siftTask } from "@/lib/workflows/sift-task";
import { type AiAdmission, admitAiRun, gateAiRequestByIp } from "../ai-gate";
import type { SiftInput } from "./execute-stage";
import { SIFT_PROMPT_VERSION } from "./stages";

/**
 * Accept a sift and hand it to the workflow.
 *
 * Order matters:
 *
 * 1. The cap gate runs first (`admitAiRun`): rate limits, the `ai_runs`
 *    window, and the tier's `siftsPerDay`.
 * 2. The task is claimed atomically (`ifSiftId` = what the caller read):
 *    it takes the new `siftId`, superseding any run still in flight, and
 *    goes `pending`. A concurrent duplicate loses the claim and stops.
 * 3. The `sift` accounting row is written *before* `start()`, so the next
 *    request already sees this sift in today's count. Without it a burst of
 *    captures would all pass the gate before any stage row lands.
 * 4. `start()`; if the runtime refuses, the accounting row flips to
 *    `failed` and the task shows a retryable error instead of hanging.
 */

export type EnqueueResult =
  | { ok: true; task: Task; siftId: string; runId: string }
  | { ok: false; reason: "denied"; admission: Extract<AiAdmission, { ok: false }>; task: Task }
  | { ok: false; reason: "not_started"; task: Task }
  /** Another request claimed the task between the caller's read and this one. */
  | { ok: false; reason: "already_sifting"; task: Task };

export const SIFT_NOT_STARTED_MESSAGE = "Sifting could not start — try again.";

export async function enqueueSift(args: {
  req: Request;
  session: Session;
  task: Task;
  modelPreference: string | null;
  offline: boolean;
  /** Rate-limit bucket; "triage" for both capture and re-sift. */
  bucket?: string;
  /** Also apply the per-IP AI limit (routes that did not already apply it). */
  checkIp?: boolean;
}): Promise<EnqueueResult> {
  const repos = getRepos();
  const { session, task } = args;
  const userId = session.user.id;
  const bucket = args.bucket ?? "triage";

  let admission: AiAdmission = { ok: true };
  if (args.checkIp) {
    const ip = await gateAiRequestByIp(args.req, bucket);
    if (!ip.ok) {
      admission = {
        ok: false,
        status: 429,
        body: (await ip.response.clone().json()) as Record<string, unknown>,
        headers: Object.fromEntries(ip.response.headers.entries()),
      };
    }
  }
  if (admission.ok) admission = await admitAiRun({ req: args.req, session, bucket });
  if (!admission.ok) {
    // The task exists either way; the denial is recorded on it so the UI
    // can show the cap message and offer the upgrade path.
    // Guarded like every sift write: a run that claimed the task since the
    // caller's read keeps its status.
    const denied =
      (await repos.tasks.update(
        userId,
        task.id,
        {
          aiStatus: "failed",
          aiError: String(admission.body.error ?? "Sifting is not available right now."),
          siftStage: null,
        },
        { ifSiftId: task.siftId },
      )) ??
      (await repos.tasks.get(userId, task.id)) ??
      task;
    return { ok: false, reason: "denied", admission, task: denied };
  }

  // Claim the task for this sift first, conditional on the siftId the
  // caller read. Two overlapping creates (or re-sifts) race here and
  // exactly one wins; the loser enqueues nothing and bills nothing.
  const siftId = makeId("sift");
  const pending = await repos.tasks.update(
    userId,
    task.id,
    { aiStatus: "pending", aiError: null, siftId, siftStage: null },
    { ifSiftId: task.siftId },
  );
  if (!pending) {
    const current = (await repos.tasks.get(userId, task.id)) ?? task;
    return { ok: false, reason: "already_sifting", task: current };
  }

  // The previous sift may be suspended on a clarifying question. This sift
  // owns the task now, so that question is moot: close it and let its run
  // end instead of leaving a stale item in the Decisions inbox.
  if (task.siftId) await expireOpenDecisionsForTask(repos, userId, task.id);

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
  // Only while this sift still owns the task; a newer claim keeps its state.
  const task =
    (await repos.tasks.update(
      input.userId,
      input.taskId,
      { aiStatus: "failed", aiError: message },
      { ifSiftId: input.siftId },
    )) ?? (await repos.tasks.get(input.userId, input.taskId));
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
