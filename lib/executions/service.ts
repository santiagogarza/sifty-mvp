import type { Session } from "@/lib/auth/session";
import { type Repos, getRepos } from "@/lib/db/repos";
import { DECISION_TTL_MS, decisionHookToken } from "@/lib/decisions/hook";
import { answerText, wakeDecisionRun } from "@/lib/decisions/service";
import type {
  ApprovalPayload,
  Decision,
  DraftReviewPayload,
  Execution,
  ExecutionDraft,
  ExecutionPolicy,
  ExecutorKind,
  Task,
} from "@/lib/domain/types";
import {
  type ExecutionDenialCode,
  budgetExhaustedMessage,
  canStartExecution,
  deriveEntitlement,
} from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { startWorkflow } from "@/lib/workflows/dispatch";
import { executeTask } from "@/lib/workflows/execute-task";
import { REJECT_OPTION, sameDraft } from "./copy";
import { recordExecutionEvent } from "./events";
import { type ExecutorDefinition, getExecutor } from "./executors";
import { EXECUTION_SLOTS_PER_USER, type ExecutionInput } from "./input";
import { type PolicyResolution, resolveExecutionPolicy } from "./policy";
import { TERMINAL_STATUSES, isTerminal, isWaiting } from "./state";

/**
 * The execution service: everything a route or another worker needs to
 * start, stop, or resolve an execution without knowing the workflow.
 *
 * Order on enqueue:
 *
 * 1. Executor and policy are resolved (`getExecutor`, D9 rules).
 * 2. The tier gate: a zero budget (free) refuses before any row exists.
 * 3. `executions.create` — idempotent on `(user, idempotencyKey)`; a replay
 *    returns the earlier row and starts nothing.
 * 4. `executions.reserve` holds the executor's estimate against the
 *    month's budget, atomically per user; refused → the row is `failed`
 *    with the budget message and an `execution.budget_refused` event.
 * 5. `startWorkflow(executeTask)`; if the runtime refuses, the row is
 *    `failed` and the hold is released.
 *
 * Decisions: `resolveExecutionDecision` is what the Decisions actions call
 * for `approval` / `draft_review`. It moves the execution in the database
 * first (CAS), then wakes the suspended run; if no run is waiting (deploy,
 * deadline, crash) and more work is needed, it starts a fresh run, so an
 * approval is never lost.
 */

export type { ExecutionInput };
export { EXECUTION_SLOTS_PER_USER };
/** Bounded reads of the step log. */
export const STEPS_LIMIT = 500;

export type EnqueueExecutionResult =
  | {
      ok: true;
      execution: Execution;
      created: boolean;
      runId: string | null;
      policy: PolicyResolution;
    }
  | { ok: false; reason: "executor_unavailable"; executor: ExecutorKind }
  | {
      ok: false;
      reason: "denied";
      code: ExecutionDenialCode;
      message: string;
      /** Present for a budget refusal: the row that records it. */
      execution: Execution | null;
    }
  | { ok: false; reason: "not_started"; execution: Execution }
  /** Another execution of this task is already in flight. */
  | { ok: false; reason: "already_running"; execution: Execution };

export const EXECUTION_NOT_STARTED_MESSAGE = "Sifty could not start on this — try again.";
const ACTIVE_PER_TASK_LIMIT = 5;

export async function enqueueExecution(args: {
  session: Session;
  task: Task;
  executor?: ExecutorKind;
  policy?: ExecutionPolicy | null;
  idempotencyKey?: string | null;
  offline: boolean;
  modelPreference: string | null;
  repos?: Repos;
  now?: Date;
}): Promise<EnqueueExecutionResult> {
  const repos = args.repos ?? getRepos();
  const userId = args.session.user.id;
  const now = args.now ?? new Date();
  const kind = args.executor ?? defaultExecutorFor(args.task);
  const def = getExecutor(kind);
  if (!def) return { ok: false, reason: "executor_unavailable", executor: kind };

  const connector = def.connectorFor(args.task);
  const policy = await resolveExecutionPolicy(repos, userId, {
    taskId: args.task.id,
    connector,
    executor: def,
    requested: args.policy ?? null,
  });

  const estimate = def.estimateCents(args.task);
  const usage = await repos.executions.monthlyUsage(userId, now);
  const entitlement = deriveEntitlement({
    profile: args.session.user,
    snapshot: args.session.entitlement,
    now,
  });
  const admission = canStartExecution(entitlement, {
    usedCents: usage.committedCents + usage.reservedCents,
    estimateCents: estimate,
  });
  if (!admission.ok && admission.code === "execution_pro") {
    return {
      ok: false,
      reason: "denied",
      code: admission.code,
      message: admission.reason,
      execution: null,
    };
  }

  // One live execution per task: a second "Run now" while the first is
  // working (or waiting on the user) would double the work.
  const active = (
    await repos.executions.listForTask(userId, args.task.id, { limit: ACTIVE_PER_TASK_LIMIT })
  ).find((e) => !isTerminal(e.status));
  const idempotencyKey = args.idempotencyKey?.trim() || makeId("run");
  if (active && active.idempotencyKey !== idempotencyKey) {
    return { ok: false, reason: "already_running", execution: active };
  }

  const created = await repos.executions.create(userId, {
    taskId: args.task.id,
    executor: def.kind,
    policy: policy.policy,
    connector,
    idempotencyKey,
  });
  if (!created.created) {
    return { ok: true, execution: created.execution, created: false, runId: null, policy };
  }
  let execution = created.execution;
  await recordExecutionEvent(repos, userId, execution, "execution.queued", {
    policySource: policy.source,
    downgraded: policy.downgraded,
    estimateCents: estimate,
  });

  const capCents = admission.ok ? admission.capCents : entitlement.caps.executionBudgetCentsMonth;
  const reserved = await repos.executions.reserve(userId, execution.id, {
    cents: estimate,
    capCents,
    now,
  });
  if (!reserved.ok) {
    const message = budgetExhaustedMessage(capCents);
    const failed =
      (await repos.executions.transition(userId, execution.id, {
        from: ["queued"],
        to: "failed",
        patch: { error: message, finishedAt: now.toISOString() },
      })) ?? execution;
    await recordExecutionEvent(repos, userId, execution, "execution.budget_refused", {
      reason: message,
      capCents: Number.isFinite(capCents) ? capCents : null,
      usedCents: reserved.reason === "budget" ? reserved.usage.committedCents : null,
    });
    return {
      ok: false,
      reason: "denied",
      code: "execution_budget",
      message,
      execution: failed,
    };
  }
  execution = reserved.execution;

  const input: ExecutionInput = {
    userId,
    executionId: execution.id,
    taskId: args.task.id,
    offline: args.offline,
    modelPreference: args.modelPreference,
  };
  try {
    const { runId } = await startWorkflow(executeTask, [input]);
    const withRun =
      (await repos.executions.update(userId, execution.id, { workflowRunId: runId })) ?? execution;
    return { ok: true, execution: withRun, created: true, runId, policy };
  } catch (err) {
    reportError(err, {
      area: "executions.enqueue",
      userId,
      tags: { taskId: args.task.id, executionId: execution.id },
    });
    const failed = await failExecution(repos, userId, execution.id, EXECUTION_NOT_STARTED_MESSAGE);
    return { ok: false, reason: "not_started", execution: failed ?? execution };
  }
}

/** The plan stage's suggestion, mapped onto an executor that exists today. */
export function defaultExecutorFor(task: Pick<Task, "plan">): ExecutorKind {
  const suggested = task.plan?.executor;
  if (suggested === "cursor_agent" && getExecutor("cursor_agent")) return "cursor_agent";
  if (suggested === "ai_agent" && getExecutor("ai_agent")) return "ai_agent";
  return "research";
}

/** Terminal failure from any non-terminal status; releases the budget hold. */
export async function failExecution(
  repos: Repos,
  userId: string,
  executionId: string,
  message: string,
): Promise<Execution | null> {
  const failed = await repos.executions.transition(userId, executionId, {
    from: ["queued", "running", "needs_approval", "needs_decision", "drafted"],
    to: "failed",
    patch: { error: message, decisionId: null, finishedAt: new Date().toISOString() },
  });
  if (!failed) return repos.executions.get(userId, executionId);
  const settled = await settleExecution(repos, userId, failed);
  await closeDecisionOf(repos, userId, failed);
  await recordExecutionEvent(repos, userId, failed, "execution.failed", { error: message });
  return settled;
}

/** Replace the budget hold with the sum of the step log's costs. */
export async function settleExecution(
  repos: Repos,
  userId: string,
  execution: Execution,
): Promise<Execution> {
  const steps = await repos.executions.listSteps(userId, execution.id, { limit: STEPS_LIMIT });
  const costCents = steps.reduce((sum, s) => sum + s.costCents, 0);
  return (await repos.executions.settle(userId, execution.id, { costCents })) ?? execution;
}

export type CancelExecutionResult =
  | { ok: true; execution: Execution; immediate: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "already_finished"; execution: Execution };

/**
 * Stop an execution. Queued or waiting on the user: cancelled at once
 * (the decision it waited on is closed as moot and the run released).
 * Running: flagged; the run stops at its next checkpoint.
 */
export async function cancelExecution(args: {
  userId: string;
  executionId: string;
  repos?: Repos;
}): Promise<CancelExecutionResult> {
  const repos = args.repos ?? getRepos();
  const { userId, executionId } = args;
  const execution = await repos.executions.get(userId, executionId);
  if (!execution) return { ok: false, reason: "not_found" };
  if (isTerminal(execution.status)) return { ok: false, reason: "already_finished", execution };

  if (execution.status === "running") {
    const flagged =
      (await repos.executions.update(userId, executionId, { cancelRequested: true })) ?? execution;
    return { ok: true, execution: flagged, immediate: false };
  }

  const cancelled = await cancelWith(repos, userId, execution, "user", "The user stopped it.");
  if (!cancelled) {
    const current = (await repos.executions.get(userId, executionId)) ?? execution;
    if (isTerminal(current.status))
      return { ok: false, reason: "already_finished", execution: current };
    // Moved to `running` under us: fall back to the flag.
    const flagged =
      (await repos.executions.update(userId, executionId, { cancelRequested: true })) ?? current;
    return { ok: true, execution: flagged, immediate: false };
  }
  return { ok: true, execution: cancelled, immediate: true };
}

/**
 * Before a task is deleted: stop whatever is still working on it, so the
 * suspended runs end instead of waiting out their deadline on a row the
 * cascade removed. Returns how many were cancelled.
 */
export async function cancelExecutionsForTask(
  repos: Repos,
  userId: string,
  taskId: string,
): Promise<number> {
  const live = (
    await repos.executions.listForTask(userId, taskId, { limit: ACTIVE_PER_TASK_LIMIT })
  ).filter((e) => !isTerminal(e.status));
  let cancelled = 0;
  for (const execution of live) {
    const done = await cancelWith(repos, userId, execution, "user", "The task was deleted.");
    if (done) cancelled += 1;
    else await repos.executions.update(userId, execution.id, { cancelRequested: true });
  }
  return cancelled;
}

/**
 * CAS into `cancelled` from any non-terminal status, settle, close the
 * decision the run was waiting on (as `expired`, i.e. moot) and wake the
 * run so it can end. Null when the row already moved.
 */
export async function cancelWith(
  repos: Repos,
  userId: string,
  execution: Execution,
  reason: NonNullable<Execution["cancelReason"]>,
  detail: string,
): Promise<Execution | null> {
  const cancelled = await repos.executions.transition(userId, execution.id, {
    from: ["queued", "running", "needs_approval", "needs_decision", "drafted"],
    to: "cancelled",
    patch: {
      cancelReason: reason,
      cancelRequested: reason === "user" ? true : execution.cancelRequested,
      decisionId: null,
      error: null,
      finishedAt: new Date().toISOString(),
    },
  });
  if (!cancelled) return null;
  const settled = await settleExecution(repos, userId, cancelled);
  await recordExecutionEvent(repos, userId, cancelled, "execution.cancelled", {
    reason,
    detail,
  });
  if (execution.decisionId) {
    const closed = await repos.decisions.resolve(userId, execution.decisionId, {
      status: "expired",
      answer: null,
    });
    if (closed) await wakeDecisionRun(userId, closed);
  }
  return settled;
}

async function closeDecisionOf(repos: Repos, userId: string, execution: Execution): Promise<void> {
  const open = await repos.decisions.listOpenForTask(userId, execution.taskId, { limit: 10 });
  for (const d of open) {
    const p = d.payload;
    if ((p.kind !== "approval" && p.kind !== "draft_review") || p.executionId !== execution.id) {
      continue;
    }
    const closed = await repos.decisions.resolve(userId, d.id, { status: "expired", answer: null });
    if (closed) await wakeDecisionRun(userId, closed);
  }
}

export type ExecutionDecisionMode =
  /** `ask_first` approved: the run continues with the work. */
  | "approved"
  /** The draft was approved as written; the execution is done. */
  | "accepted"
  /** The draft was edited, then approved; the execution is done with the edit. */
  | "edited"
  /** A `needs_decision` question was answered; the run continues. */
  | "answered"
  | "rejected"
  | "expired"
  /** The decision no longer belongs to the execution's current wait (or the row is gone). */
  | "stale";

export interface ApplyDecisionResult {
  execution: Execution | null;
  mode: ExecutionDecisionMode;
  /** True when the run must do more work (woken or restarted by the caller). */
  needsRun: boolean;
}

/**
 * Move the execution for a resolved `approval` / `draft_review` decision.
 * Pure database work (CAS transitions, settlement, events); the caller
 * wakes or restarts the run. Idempotent: the run's own reconcile step
 * may apply the same decision again and finds nothing to do.
 */
export async function applyExecutionDecision(
  repos: Repos,
  userId: string,
  decision: Decision,
): Promise<ApplyDecisionResult> {
  const payload = decision.payload;
  if (payload.kind !== "approval" && payload.kind !== "draft_review") {
    return { execution: null, mode: "stale", needsRun: false };
  }
  const execution = await repos.executions.get(userId, payload.executionId);
  if (!execution) return { execution: null, mode: "stale", needsRun: false };
  if (execution.decisionId !== decision.id || !isWaiting(execution.status)) {
    return { execution, mode: "stale", needsRun: false };
  }
  const now = new Date().toISOString();

  if (decision.status === "expired") {
    const cancelled = await cancelWith(repos, userId, execution, "expired", "No answer in time.");
    return {
      execution: cancelled ?? execution,
      mode: cancelled ? "expired" : "stale",
      needsRun: false,
    };
  }
  const rejected =
    decision.status === "dismissed" ||
    (decision.status === "answered" && decision.answer?.option === REJECT_OPTION);
  if (rejected) {
    await recordExecutionEvent(repos, userId, execution, "execution.rejected", {
      decisionId: decision.id,
      kind: payload.kind,
      via: decision.answer?.via ?? "app",
    });
    const cancelled = await cancelWith(repos, userId, execution, "rejected", "You rejected it.");
    return {
      execution: cancelled ?? execution,
      mode: cancelled ? "rejected" : "stale",
      needsRun: false,
    };
  }
  if (decision.status !== "answered") return { execution, mode: "stale", needsRun: false };

  if (payload.kind === "approval") {
    const answer = decision.answer ? answerText(decision.answer) : "";
    const from = payload.reason === "ask_first" ? "needs_approval" : "needs_decision";
    const running = await repos.executions.transition(userId, execution.id, {
      from: [from],
      to: "running",
      patch: {
        decisionId: null,
        startedAt: execution.startedAt ?? now,
        answers: payload.reason === "question" ? [...execution.answers, answer] : execution.answers,
      },
    });
    if (!running) return { execution, mode: "stale", needsRun: false };
    await recordExecutionEvent(
      repos,
      userId,
      running,
      "execution.approved",
      {
        decisionId: decision.id,
        reason: payload.reason,
        answer,
        via: decision.answer?.via ?? "app",
      },
      decision.id,
    );
    return {
      execution: running,
      mode: payload.reason === "ask_first" ? "approved" : "answered",
      needsRun: true,
    };
  }

  const finalDraft = acceptedDraft(payload, decision.answer?.draft ?? null);
  const edited = !sameDraft(finalDraft, payload.draft);
  const done = await repos.executions.transition(userId, execution.id, {
    from: ["drafted"],
    to: "done",
    patch: {
      decisionId: null,
      result: { summary: payload.summary, draft: finalDraft },
      finishedAt: now,
    },
  });
  if (!done) return { execution, mode: "stale", needsRun: false };
  const settled = await settleExecution(repos, userId, done);
  await recordExecutionEvent(
    repos,
    userId,
    settled,
    edited ? "execution.edited" : "execution.approved",
    { decisionId: decision.id, via: decision.answer?.via ?? "app" },
    decision.id,
  );
  await recordExecutionEvent(repos, userId, settled, "execution.done", {
    costCents: settled.costCents,
    summary: payload.summary,
  });
  return { execution: settled, mode: edited ? "edited" : "accepted", needsRun: false };
}

function acceptedDraft(
  payload: DraftReviewPayload,
  edit: ExecutionDraft | null | undefined,
): ExecutionDraft {
  if (!edit || !edit.body.trim()) return payload.draft;
  return {
    title: edit.title?.trim() || payload.draft.title,
    body: edit.body,
    format: payload.draft.format,
  };
}

/**
 * What the Decisions actions call for `approval` / `draft_review`: apply
 * the decision, wake the run, and if nothing was waiting but work remains,
 * start a new run for the execution.
 */
export async function resolveExecutionDecision(
  repos: Repos,
  userId: string,
  decision: Decision,
  ctx: { offline: boolean; modelPreference: string | null },
): Promise<ApplyDecisionResult & { resumed: boolean; restarted: boolean }> {
  const applied = await applyExecutionDecision(repos, userId, decision);
  const resumed = await wakeDecisionRun(userId, decision);
  let restarted = false;
  if (!resumed && applied.needsRun && applied.execution) {
    restarted = await restartExecutionRun(repos, userId, applied.execution, ctx);
  }
  return { ...applied, resumed, restarted };
}

/** A fresh workflow run for an execution whose previous run is gone. */
export async function restartExecutionRun(
  repos: Repos,
  userId: string,
  execution: Execution,
  ctx: { offline: boolean; modelPreference: string | null },
): Promise<boolean> {
  const input: ExecutionInput = {
    userId,
    executionId: execution.id,
    taskId: execution.taskId,
    offline: ctx.offline,
    modelPreference: ctx.modelPreference,
  };
  try {
    const { runId } = await startWorkflow(executeTask, [input]);
    await repos.executions.update(userId, execution.id, { workflowRunId: runId });
    return true;
  } catch (err) {
    reportError(err, {
      area: "executions.restart",
      userId,
      tags: { executionId: execution.id },
    });
    await failExecution(repos, userId, execution.id, EXECUTION_NOT_STARTED_MESSAGE);
    return false;
  }
}

/** Open an `approval` decision for an execution; the hook token is derived from the id. */
export async function openApprovalDecision(
  repos: Repos,
  userId: string,
  input: {
    id: string;
    execution: Execution;
    executor: ExecutorDefinition;
    action: string;
    question: string;
    options: string[];
    reason: ApprovalPayload["reason"];
    estimateCents: number;
    now?: Date;
  },
): Promise<Decision> {
  const now = input.now ?? new Date();
  const payload: ApprovalPayload = {
    kind: "approval",
    executionId: input.execution.id,
    executor: input.executor.kind,
    action: input.action,
    question: input.question,
    options: input.options,
    reason: input.reason,
    estimateCents: input.estimateCents,
  };
  return repos.decisions.create(userId, {
    id: input.id,
    kind: "approval",
    taskId: input.execution.taskId,
    payload,
    resumeToken: decisionHookToken(input.id),
    expiresAt: new Date(now.getTime() + DECISION_TTL_MS).toISOString(),
  });
}

export async function openDraftReviewDecision(
  repos: Repos,
  userId: string,
  input: {
    id: string;
    execution: Execution;
    executor: ExecutorDefinition;
    summary: string;
    draft: ExecutionDraft;
    now?: Date;
  },
): Promise<Decision> {
  const now = input.now ?? new Date();
  const payload: DraftReviewPayload = {
    kind: "draft_review",
    executionId: input.execution.id,
    executor: input.executor.kind,
    summary: input.summary,
    draft: input.draft,
  };
  return repos.decisions.create(userId, {
    id: input.id,
    kind: "draft_review",
    taskId: input.execution.taskId,
    payload,
    resumeToken: decisionHookToken(input.id),
    expiresAt: new Date(now.getTime() + DECISION_TTL_MS).toISOString(),
  });
}

/** The executions of one task with the newest first; the sheet shows these. */
export async function listTaskExecutions(
  repos: Repos,
  userId: string,
  taskId: string,
  limit = 10,
): Promise<Execution[]> {
  return repos.executions.listForTask(userId, taskId, { limit });
}

export { TERMINAL_STATUSES };
