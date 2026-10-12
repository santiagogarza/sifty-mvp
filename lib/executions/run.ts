import { type Repos, getRepos } from "@/lib/db/repos";
import type { DecisionResolutionPayload } from "@/lib/decisions/hook";
import type { Execution, ExecutionDraft, ExecutionStatus, Task } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { APPROVE_OPTION, REJECT_OPTION, approvalQuestion } from "./copy";
import { recordExecutionEvent } from "./events";
import {
  ExecutionCancelledError,
  type ExecutorContext,
  type ExecutorDefinition,
  type ExecutorLogInput,
  getExecutor,
} from "./executors";
import { redactRecord } from "./redact";
import {
  type ExecutionInput,
  STEPS_LIMIT,
  applyExecutionDecision,
  cancelWith,
  failExecution,
  openApprovalDecision,
  openDraftReviewDecision,
  settleExecution,
} from "./service";
import { isTerminal, isWaiting } from "./state";

/**
 * The bodies of the `executeTask` workflow steps, free of workflow
 * directives so they run under Vitest against the in-memory repos.
 *
 * Every body re-reads the execution and moves it with a CAS transition,
 * so a user action that landed in between (cancel, approve from another
 * tab) wins and the run notices at its next step. Ids that a later step
 * depends on (a decision the workflow must register a hook for) are
 * minted inside a step, never in the workflow body, because the body is
 * replayed and must stay deterministic.
 */

export interface ExecutionSnapshot {
  status: ExecutionStatus;
  policy: Execution["policy"];
  cancelRequested: boolean;
  decisionId: string | null;
}

export async function readExecution(input: ExecutionInput): Promise<ExecutionSnapshot | null> {
  const execution = await getRepos().executions.get(input.userId, input.executionId);
  if (!execution) return null;
  return {
    status: execution.status,
    policy: execution.policy,
    cancelRequested: execution.cancelRequested,
    decisionId: execution.decisionId,
  };
}

export type BeginOutcome = "applied" | "cancelled" | "skipped";

/** `queued → running`, unless the user already asked to stop. */
export async function beginExecution(
  input: ExecutionInput,
  workflowRunId: string | null,
): Promise<BeginOutcome> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution) return "skipped";
  if (execution.status === "queued" && execution.cancelRequested) {
    const cancelled = await cancelWith(
      repos,
      input.userId,
      execution,
      "user",
      "Stopped before it started.",
    );
    return cancelled ? "cancelled" : "skipped";
  }
  const running = await repos.executions.transition(input.userId, input.executionId, {
    from: ["queued"],
    to: "running",
    patch: { startedAt: new Date().toISOString(), workflowRunId },
  });
  if (!running) return "skipped";
  await recordExecutionEvent(repos, input.userId, running, "execution.started");
  console.log(`[workflow] exec ${input.executionId}: running (${running.executor})`);
  return "applied";
}

export interface PendingApproval {
  decisionId: string;
  action: string;
  estimateCents: number;
}

/** Mint the `ask_first` decision id and gather what its card says. */
export async function prepareApproval(input: ExecutionInput): Promise<PendingApproval | null> {
  const repos = getRepos();
  const [execution, task] = await Promise.all([
    repos.executions.get(input.userId, input.executionId),
    repos.tasks.get(input.userId, input.taskId),
  ]);
  if (!execution || !task || execution.status !== "queued") return null;
  const def = getExecutor(execution.executor);
  if (!def) return null;
  return {
    decisionId: makeId("dec"),
    action: def.describeAction(task),
    estimateCents: def.estimateCents(task),
  };
}

export type OpenOutcome = "applied" | "skipped";

/**
 * Open the `ask_first` approval and park the execution on it. Runs after
 * the workflow registered the hook for `pending.decisionId`. The CAS is
 * `queued → needs_approval`; when it misses (cancelled meanwhile) the
 * freshly created decision is closed again so the inbox never shows a
 * card for a dead run.
 */
export async function openApproval(
  input: ExecutionInput,
  pending: PendingApproval,
): Promise<OpenOutcome> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution) return "skipped";
  const def = getExecutor(execution.executor);
  if (!def) return "skipped";
  if (execution.status === "queued" && execution.cancelRequested) {
    await cancelWith(repos, input.userId, execution, "user", "Stopped before it started.");
    return "skipped";
  }
  const decision = await openApprovalDecision(repos, input.userId, {
    id: pending.decisionId,
    execution,
    executor: def,
    action: pending.action,
    question: approvalQuestion(pending.action),
    options: [APPROVE_OPTION, REJECT_OPTION],
    reason: "ask_first",
    estimateCents: pending.estimateCents,
  });
  const parked = await repos.executions.transition(input.userId, input.executionId, {
    from: ["queued"],
    to: "needs_approval",
    patch: { decisionId: decision.id },
  });
  if (!parked) {
    await repos.decisions.resolve(input.userId, decision.id, { status: "expired", answer: null });
    return "skipped";
  }
  await recordExecutionEvent(repos, input.userId, parked, "execution.needs_approval", {
    decisionId: decision.id,
    action: pending.action,
  });
  console.log(`[workflow] exec ${input.executionId}: waiting for approval`);
  return "applied";
}

export type RunStepResult =
  /** Terminal, or the status moved under the run (user action); nothing to wait on. */
  | { kind: "finished"; status: ExecutionStatus | "missing" }
  /** A draft to review: the workflow registers the hook, then `openDraft`. */
  | { kind: "draft"; decisionId: string; summary: string; draft: ExecutionDraft }
  /** The executor asked: the workflow registers the hook, then `openQuestion`. */
  | { kind: "question"; decisionId: string; question: string; options: string[] };

/**
 * Run the executor once, log what it did, and apply the policy to its
 * outcome. `done` and an `ask_first` or `auto` draft finish the execution;
 * `draft_then_approve` hands the draft back for review; a question parks
 * the run.
 */
export async function runExecutor(
  input: ExecutionInput,
  workflowRunId: string | null,
): Promise<RunStepResult> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution) return { kind: "finished", status: "missing" };
  if (execution.status !== "running") return { kind: "finished", status: execution.status };
  if (execution.cancelRequested) {
    const cancelled = await cancelWith(
      repos,
      input.userId,
      execution,
      "user",
      "Stopped while working.",
    );
    return { kind: "finished", status: cancelled ? "cancelled" : execution.status };
  }
  const task = await repos.tasks.get(input.userId, input.taskId);
  if (!task) {
    await failExecution(repos, input.userId, execution.id, "The task was deleted.");
    return { kind: "finished", status: "failed" };
  }
  const def = getExecutor(execution.executor);
  if (!def) {
    await failExecution(
      repos,
      input.userId,
      execution.id,
      `No ${execution.executor} executor is available yet.`,
    );
    return { kind: "finished", status: "failed" };
  }
  if (workflowRunId && execution.workflowRunId !== workflowRunId) {
    await repos.executions.update(input.userId, execution.id, { workflowRunId });
  }

  const log = await stepLogger(repos, input, execution);
  const ctx: ExecutorContext = {
    execution,
    task,
    answers: execution.answers,
    offline: input.offline,
    modelPreference: input.modelPreference,
    log,
    checkCancelled: async () => {
      const fresh = await repos.executions.get(input.userId, input.executionId);
      if (!fresh || fresh.cancelRequested || fresh.status !== "running") {
        throw new ExecutionCancelledError();
      }
    },
  };

  let outcome: Awaited<ReturnType<ExecutorDefinition["run"]>>;
  try {
    outcome = await def.run(ctx);
  } catch (err) {
    if (err instanceof ExecutionCancelledError) {
      const cancelled = await cancelWith(
        repos,
        input.userId,
        execution,
        "user",
        "Stopped while working.",
      );
      return { kind: "finished", status: cancelled ? "cancelled" : "running" };
    }
    const message = err instanceof Error ? err.message : String(err);
    reportError(err, {
      area: `executions.${execution.executor}`,
      userId: input.userId,
      tags: { executionId: execution.id, taskId: task.id },
    });
    await log({ kind: "note", name: "executor.error", status: "error", output: { message } });
    // Transient provider errors get Workflow's retries; the row stays `running`.
    throw err;
  }

  switch (outcome.kind) {
    case "failed": {
      await log({
        kind: "note",
        name: "executor.failed",
        status: "error",
        output: { error: outcome.error },
      });
      await failExecution(repos, input.userId, execution.id, outcome.error);
      return { kind: "finished", status: "failed" };
    }
    case "done": {
      const finished = await finishExecution(
        repos,
        input,
        execution,
        outcome.summary,
        outcome.draft,
      );
      return { kind: "finished", status: finished ? "done" : "running" };
    }
    case "draft": {
      // `ask_first` was approved before the work; `auto` is only resolved
      // for read-only executors. Both apply the result without a review.
      if (execution.policy !== "draft_then_approve") {
        const finished = await finishExecution(
          repos,
          input,
          execution,
          outcome.summary,
          outcome.draft,
        );
        return { kind: "finished", status: finished ? "done" : "running" };
      }
      return {
        kind: "draft",
        decisionId: makeId("dec"),
        summary: outcome.summary,
        draft: outcome.draft,
      };
    }
    case "needs_decision":
      return {
        kind: "question",
        decisionId: makeId("dec"),
        question: outcome.question,
        options: outcome.options.length ? outcome.options : [APPROVE_OPTION],
      };
  }
}

async function finishExecution(
  repos: Repos,
  input: ExecutionInput,
  execution: Execution,
  summary: string,
  draft: ExecutionDraft | null,
): Promise<Execution | null> {
  const done = await repos.executions.transition(input.userId, execution.id, {
    from: ["running"],
    to: "done",
    patch: { result: { summary, draft }, finishedAt: new Date().toISOString() },
  });
  if (!done) return null;
  const settled = await settleExecution(repos, input.userId, done);
  await recordExecutionEvent(repos, input.userId, settled, "execution.done", {
    costCents: settled.costCents,
    summary,
  });
  console.log(`[workflow] exec ${input.executionId}: done`);
  return settled;
}

/** `running → drafted` with a `draft_review` decision; hook already registered. */
export async function openDraft(
  input: ExecutionInput,
  pending: Extract<RunStepResult, { kind: "draft" }>,
): Promise<OpenOutcome> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution || execution.status !== "running") return "skipped";
  const def = getExecutor(execution.executor);
  if (!def) return "skipped";
  const decision = await openDraftReviewDecision(repos, input.userId, {
    id: pending.decisionId,
    execution,
    executor: def,
    summary: pending.summary,
    draft: pending.draft,
  });
  const parked = await repos.executions.transition(input.userId, input.executionId, {
    from: ["running"],
    to: "drafted",
    patch: { decisionId: decision.id, result: { summary: pending.summary, draft: pending.draft } },
  });
  if (!parked) {
    await repos.decisions.resolve(input.userId, decision.id, { status: "expired", answer: null });
    return "skipped";
  }
  await recordExecutionEvent(repos, input.userId, parked, "execution.drafted", {
    decisionId: decision.id,
    summary: pending.summary,
  });
  console.log(`[workflow] exec ${input.executionId}: drafted, waiting for review`);
  return "applied";
}

/** `running → needs_decision` with an `approval` decision carrying the executor's question. */
export async function openQuestion(
  input: ExecutionInput,
  pending: Extract<RunStepResult, { kind: "question" }>,
): Promise<OpenOutcome> {
  const repos = getRepos();
  const [execution, task] = await Promise.all([
    repos.executions.get(input.userId, input.executionId),
    repos.tasks.get(input.userId, input.taskId),
  ]);
  if (!execution || !task || execution.status !== "running") return "skipped";
  const def = getExecutor(execution.executor);
  if (!def) return "skipped";
  const decision = await openApprovalDecision(repos, input.userId, {
    id: pending.decisionId,
    execution,
    executor: def,
    action: def.describeAction(task),
    question: pending.question,
    options: pending.options,
    reason: "question",
    estimateCents: 0,
  });
  const parked = await repos.executions.transition(input.userId, input.executionId, {
    from: ["running"],
    to: "needs_decision",
    patch: { decisionId: decision.id },
  });
  if (!parked) {
    await repos.decisions.resolve(input.userId, decision.id, { status: "expired", answer: null });
    return "skipped";
  }
  await recordExecutionEvent(
    repos,
    input.userId,
    parked,
    "execution.needs_decision",
    { decisionId: decision.id, question: pending.question },
    decision.id,
  );
  console.log(`[workflow] exec ${input.executionId}: asked "${pending.question}"`);
  return "applied";
}

/**
 * The deadline fired. Close the decision as `expired` unless the user got
 * there first, apply whatever the row now says, and report it so the
 * workflow continues on the real status.
 */
export async function expireExecutionDecision(
  input: ExecutionInput,
  decisionId: string,
): Promise<DecisionResolutionPayload> {
  const repos = getRepos();
  const resolved = await repos.decisions.resolve(input.userId, decisionId, {
    status: "expired",
    answer: null,
  });
  const current = resolved ?? (await repos.decisions.get(input.userId, decisionId));
  if (!current) {
    const execution = await repos.executions.get(input.userId, input.executionId);
    if (execution && isWaiting(execution.status)) {
      await cancelWith(repos, input.userId, execution, "expired", "No answer in time.");
    }
    return { status: "expired" };
  }
  await applyExecutionDecision(repos, input.userId, current);
  if (current.status === "answered" && current.answer) {
    return { status: "answered", answer: current.answer };
  }
  return { status: current.status === "dismissed" ? "dismissed" : "expired" };
}

/**
 * After a wake: the service normally moved the row before resuming the
 * run, but a decision resolved by a path that could not (a crash between
 * the CAS and the wake) is applied here. Returns the status to continue on.
 */
export async function reconcileExecution(
  input: ExecutionInput,
): Promise<ExecutionStatus | "missing"> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution) return "missing";
  if (!isWaiting(execution.status) || !execution.decisionId) return execution.status;
  const decision = await repos.decisions.get(input.userId, execution.decisionId);
  if (!decision) {
    const cancelled = await cancelWith(
      repos,
      input.userId,
      execution,
      "expired",
      "The decision is gone.",
    );
    return cancelled?.status ?? execution.status;
  }
  if (decision.status === "open") return execution.status;
  const applied = await applyExecutionDecision(repos, input.userId, decision);
  return applied.execution?.status ?? execution.status;
}

/** Terminal failure of the whole run (an exception escaped every step). */
export async function failRun(input: ExecutionInput, message: string): Promise<void> {
  const repos = getRepos();
  const execution = await repos.executions.get(input.userId, input.executionId);
  if (!execution || isTerminal(execution.status)) return;
  await failExecution(repos, input.userId, execution.id, message);
}

/**
 * An idempotent logger: `seq` continues from what is already stored, and
 * the step id is derived from it, so a retried executor call that logs
 * the same entries again leaves one row each.
 */
async function stepLogger(
  repos: Repos,
  input: ExecutionInput,
  execution: Execution,
): Promise<ExecutorContext["log"]> {
  const existing = await repos.executions.listSteps(input.userId, execution.id, {
    limit: STEPS_LIMIT,
  });
  let seq = existing.length ? existing[existing.length - 1]!.seq + 1 : 0;
  return async (step: ExecutorLogInput) => {
    const mine = seq;
    seq += 1;
    if (mine >= STEPS_LIMIT) return;
    await repos.executions.appendStep(input.userId, {
      id: `${execution.id}:${mine}`,
      executionId: execution.id,
      seq: mine,
      kind: step.kind,
      name: step.name,
      status: step.status ?? "ok",
      input: redactRecord(step.input),
      output: redactRecord(step.output),
      durationMs: step.durationMs ?? null,
      costCents: step.costCents ?? 0,
    });
  };
}

/** The task an execution is about, for executors that need a fresh read. */
export async function taskOf(input: ExecutionInput): Promise<Task | null> {
  return getRepos().tasks.get(input.userId, input.taskId);
}
