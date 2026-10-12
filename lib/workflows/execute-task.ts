import {
  DECISION_TTL_MS,
  type DecisionResolutionPayload,
  decisionHookToken,
} from "@/lib/decisions/hook";
import type { ExecutionStatus } from "@/lib/domain/types";
import { EXECUTION_SLOTS_PER_USER, type ExecutionInput } from "@/lib/executions/input";
import {
  type BeginOutcome,
  type ExecutionSnapshot,
  type OpenOutcome,
  type PendingApproval,
  type RunStepResult,
  beginExecution,
  expireExecutionDecision,
  failRun,
  openApproval,
  openDraft,
  openQuestion,
  prepareApproval,
  readExecution,
  reconcileExecution,
  runExecutor,
} from "@/lib/executions/run";
import { createHook, getWorkflowMetadata, sleep } from "workflow";
import { acquireUserSlot } from "./user-lock";

/**
 * `executeTask` — one execution of one task by one executor, driven by
 * the row's status rather than by a fixed sequence of steps:
 *
 *   read ──► queued ──► ask_first? open approval, wait ──┐
 *               │                                        │
 *               └──► begin ──► running ──► run executor ──┤
 *                                   │   done/failed ──► return
 *                                   ├─► draft: open review, wait ─┐
 *                                   └─► question: open, wait ─────┤
 *                                                                 │
 *   (woken) ──► read ──► … continues on the new status ◄──────────┘
 *
 * Waiting costs nothing: the run suspends on the decision's hook (token
 * `decision:<id>`, registered before the decision row exists) and
 * releases its per-user slot, for up to `DECISION_TTL_MS`. The Decisions
 * service moves the row (approve → `running`, accept → `done`, reject →
 * `cancelled`) *before* it wakes the run, so the loop only ever reads
 * state and acts on it; `reconcile` covers a wake whose write did not
 * land. If the run itself is gone when the user decides, the service
 * starts a new one and this loop picks up wherever the row is.
 *
 * Cancellation is cooperative: the user's request flips `cancelRequested`
 * (or moves a parked row straight to `cancelled`); every step re-reads
 * and stops at the next boundary.
 */
export const MAX_ROUNDS = 12;

export type ExecuteOutcome =
  | { outcome: "finished"; status: ExecutionStatus }
  | { outcome: "missing" }
  | { outcome: "stalled"; rounds: number };

export async function executeTask(input: ExecutionInput): Promise<ExecuteOutcome> {
  "use workflow";
  let slot = await acquireUserSlot("exec", input.userId, EXECUTION_SLOTS_PER_USER);
  const { workflowRunId } = getWorkflowMetadata();
  console.log(`[workflow] exec ${input.executionId}: start (${workflowRunId})`);

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const current = await readStep(input);
      if (!current) return { outcome: "missing" };

      switch (current.status) {
        case "queued": {
          if (current.policy === "ask_first" && !current.cancelRequested) {
            const pending = await prepareApprovalStep(input);
            if (!pending) continue;
            const hook = createHook<DecisionResolutionPayload>({
              token: decisionHookToken(pending.decisionId),
            });
            await hook.getConflict();
            const opened = await openApprovalStep(input, pending);
            if (opened !== "applied") continue;
            slot.release();
            await waitForDecision(input, hook, pending.decisionId);
            slot = await acquireUserSlot("exec", input.userId, EXECUTION_SLOTS_PER_USER);
            continue;
          }
          await beginStep(input, workflowRunId);
          continue;
        }
        case "running": {
          const ran = await runStep(input, workflowRunId);
          if (ran.kind === "finished") {
            if (ran.status === "missing") return { outcome: "missing" };
            if (ran.status === "running") continue;
            return { outcome: "finished", status: ran.status };
          }
          const hook = createHook<DecisionResolutionPayload>({
            token: decisionHookToken(ran.decisionId),
          });
          await hook.getConflict();
          const opened =
            ran.kind === "draft"
              ? await openDraftStep(input, ran)
              : await openQuestionStep(input, ran);
          if (opened !== "applied") continue;
          slot.release();
          await waitForDecision(input, hook, ran.decisionId);
          slot = await acquireUserSlot("exec", input.userId, EXECUTION_SLOTS_PER_USER);
          continue;
        }
        case "needs_approval":
        case "needs_decision":
        case "drafted": {
          // Woken, but the row still waits: apply the decision ourselves.
          const status = await reconcileStep(input);
          if (status === "missing") return { outcome: "missing" };
          if (status === current.status) {
            // Still open — a stray wake. Nothing to do until the human acts;
            // ending here is safe because the service restarts a run when
            // it finds none waiting.
            return { outcome: "finished", status };
          }
          continue;
        }
        default:
          return { outcome: "finished", status: current.status };
      }
    }
    await failStep(input, "The execution looped without finishing.");
    return { outcome: "stalled", rounds: MAX_ROUNDS };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] exec ${input.executionId}: failed — ${message}`);
    await failStep(input, message);
    throw err;
  }
}

/** Suspend on the decision; when the deadline wins, let the step report the row's real status. */
async function waitForDecision(
  input: ExecutionInput,
  hook: PromiseLike<DecisionResolutionPayload>,
  decisionId: string,
): Promise<DecisionResolutionPayload> {
  const resolution = await Promise.race([hook, deadline(DECISION_TTL_MS)]);
  if (resolution.status === "expired") return expireStep(input, decisionId);
  return resolution;
}

async function deadline(ms: number): Promise<DecisionResolutionPayload> {
  await sleep(ms);
  return { status: "expired" };
}

async function readStep(input: ExecutionInput): Promise<ExecutionSnapshot | null> {
  "use step";
  return readExecution(input);
}

async function beginStep(input: ExecutionInput, runId: string): Promise<BeginOutcome> {
  "use step";
  return beginExecution(input, runId);
}

async function prepareApprovalStep(input: ExecutionInput): Promise<PendingApproval | null> {
  "use step";
  return prepareApproval(input);
}

async function openApprovalStep(
  input: ExecutionInput,
  pending: PendingApproval,
): Promise<OpenOutcome> {
  "use step";
  return openApproval(input, pending);
}

async function runStep(input: ExecutionInput, runId: string): Promise<RunStepResult> {
  "use step";
  return runExecutor(input, runId);
}

async function openDraftStep(
  input: ExecutionInput,
  pending: Extract<RunStepResult, { kind: "draft" }>,
): Promise<OpenOutcome> {
  "use step";
  return openDraft(input, pending);
}

async function openQuestionStep(
  input: ExecutionInput,
  pending: Extract<RunStepResult, { kind: "question" }>,
): Promise<OpenOutcome> {
  "use step";
  return openQuestion(input, pending);
}

async function expireStep(
  input: ExecutionInput,
  decisionId: string,
): Promise<DecisionResolutionPayload> {
  "use step";
  return expireExecutionDecision(input, decisionId);
}

async function reconcileStep(input: ExecutionInput): Promise<ExecutionStatus | "missing"> {
  "use step";
  return reconcileExecution(input);
}

async function failStep(input: ExecutionInput, message: string): Promise<void> {
  "use step";
  return failRun(input, message);
}
