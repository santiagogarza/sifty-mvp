import { type Repos, getRepos } from "@/lib/db/repos";
import type { DecisionResolutionPayload } from "@/lib/decisions/hook";
import { answerText, openClarifyingQuestion } from "@/lib/decisions/service";
import { AI_CONTEXT_LIMITS, TASK_LIMITS } from "@/lib/domain/limits";
import type { DecisionAnswer, SiftStage, Task } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { FatalError } from "workflow";
import { recordAiRun } from "../ai-runs";
import { ensureLabelsByName } from "../ensure-labels";
import { AiConfigError } from "../provider";
import { stagePatch } from "./apply";
import { failedStageMeta, runStage } from "./run-stage";
import type { OpenTaskSummary, SiftContext, StageOutputs } from "./stages";

/**
 * The body of each `siftTask` step, kept free of workflow directives so it
 * can be unit tested against the in-memory repos with a mocked model.
 *
 * Every step re-reads the task and checks `task.siftId` before writing:
 * a re-sift replaces `siftId`, so an older run that is still in flight
 * notices it was superseded and stops instead of racing the new one. A
 * deleted task ends the run the same way.
 */

export interface SiftInput {
  userId: string;
  taskId: string;
  /** Owns `task.siftId` and groups the `ai_runs` rows of this sift. */
  siftId: string;
  /** Id of the `sift` accounting row, flipped to `failed` if the run dies. */
  accountingRunId: string;
  modelPreference: string | null;
  offline: boolean;
}

export type StepOutcome = "applied" | "superseded" | "missing";

/**
 * A clarifying question the triage stage wants to ask. Minted inside the
 * step (ids are not deterministic, so the workflow body cannot mint them)
 * and returned so the workflow can register the hook before the decision
 * becomes visible.
 */
export interface PendingQuestion {
  decisionId: string;
  question: string;
  options: string[];
  confidence: number;
}

export interface TriageStepResult {
  outcome: StepOutcome;
  question: PendingQuestion | null;
}

/** How many of the user's other open tasks the prioritize prompt sees. */
export const OPEN_TASKS_IN_CONTEXT = 25;
const RECENT_LABELS_IN_CONTEXT = 8;

export async function beginSift(input: SiftInput): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  const began = await repos.tasks.update(
    input.userId,
    input.taskId,
    // A fresh sift stands on its own: whatever the previous one assumed
    // after a dismissed question no longer applies.
    { aiStatus: "running", aiError: null, siftStage: "enrich", siftedWithAssumptions: false },
    { ifSiftId: input.siftId },
  );
  return began ? "applied" : "superseded";
}

export async function executeSiftStage(
  input: SiftInput,
  stage: SiftStage,
  workflowRunId: string | null,
): Promise<StepOutcome> {
  const { outcome } = await runSiftStage(input, stage, workflowRunId, { askQuestions: true });
  return outcome;
}

/**
 * The triage stage, plus whether it asked a question. With `askQuestions`
 * off (the pass after the user answered or dismissed) a question the model
 * still produces is dropped: one question per sift.
 */
export async function executeTriageStage(
  input: SiftInput,
  workflowRunId: string | null,
  opts: { askQuestions: boolean },
): Promise<TriageStepResult> {
  const { outcome, output } = await runSiftStage(input, "triage", workflowRunId, opts);
  if (outcome !== "applied" || !output || !opts.askQuestions || !output.clarifyingQuestion) {
    return { outcome, question: null };
  }
  return {
    outcome,
    question: {
      decisionId: makeId("dec"),
      question: output.clarifyingQuestion,
      options: output.clarifyingOptions,
      confidence: output.confidence,
    },
  };
}

async function runSiftStage<S extends SiftStage>(
  input: SiftInput,
  stage: S,
  workflowRunId: string | null,
  opts: { askQuestions: boolean },
): Promise<{ outcome: StepOutcome; output: StageOutputs[S] | null }> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return { outcome: task, output: null };

  const marked = await repos.tasks.update(
    input.userId,
    input.taskId,
    { aiStatus: "running", siftStage: stage },
    { ifSiftId: input.siftId },
  );
  if (!marked) return { outcome: "superseded", output: null };
  const ctx = await buildSiftContext(repos, input.userId, task);

  try {
    const ran = await runStage(stage, ctx, {
      modelPreference: input.modelPreference,
      offline: input.offline,
    });
    const meta = ran.meta;
    let output = ran.output;
    if (stage === "triage" && !opts.askQuestions) {
      const triage = output as StageOutputs["triage"];
      const quiet: StageOutputs["triage"] = {
        ...triage,
        clarifyingQuestion: null,
        clarifyingOptions: [],
      };
      output = quiet as unknown as StageOutputs[S];
    }

    let labelIds: string[] | undefined;
    if (stage === "enrich") {
      const names = (output as StageOutputs["enrich"]).suggestedLabels;
      labelIds = (await ensureLabelsByName(repos, input.userId, names)).map((l) => l.id);
    }

    // Re-read: the user may have edited (and protected) fields while the
    // model was thinking, or started a re-sift.
    const fresh = await owned(repos, input);
    if (typeof fresh === "string") {
      await recordAiRun({
        userId: input.userId,
        taskId: input.taskId,
        meta,
        status: "succeeded",
        siftId: input.siftId,
        workflowRunId,
      });
      return { outcome: fresh, output: null };
    }

    const patch = stagePatch(fresh, stage, output, { labelIds });
    // Conditional on `siftId`: a re-sift that landed between the read and
    // this write wins, and this run stops at the next boundary.
    const applied = await repos.tasks.update(input.userId, input.taskId, patch, {
      ifSiftId: input.siftId,
    });
    await recordAiRun({
      userId: input.userId,
      taskId: input.taskId,
      meta,
      status: "succeeded",
      siftId: input.siftId,
      workflowRunId,
    });
    if (!applied) return { outcome: "superseded", output: null };
    console.log(`[workflow] sift ${input.siftId}: ${stage} applied (${meta.model})`);
    return { outcome: "applied", output };
  } catch (err) {
    const message = err instanceof Error ? err.message : `${stage} failed`;
    reportError(err, {
      area: `sift.${stage}`,
      userId: input.userId,
      tags: { taskId: input.taskId, siftId: input.siftId, offline: input.offline },
    });
    await recordAiRun({
      userId: input.userId,
      taskId: input.taskId,
      meta: failedStageMeta(stage, input.offline),
      status: "failed",
      error: message,
      siftId: input.siftId,
      workflowRunId,
    });
    // Operator misconfiguration cannot be retried into success; everything
    // else (provider 5xx, timeouts, schema misses) gets Workflow's retries.
    if (err instanceof AiConfigError) throw new FatalError(message);
    throw err;
  }
}

export async function finishSift(input: SiftInput): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  const finished = await repos.tasks.update(
    input.userId,
    input.taskId,
    { aiStatus: "ready", aiError: null, siftStage: null, aiAttempts: task.aiAttempts + 1 },
    { ifSiftId: input.siftId },
  );
  if (!finished) return "superseded";
  console.log(`[workflow] sift ${input.siftId}: ready`);
  return "applied";
}

/** Terminal failure: surface it on the task and stop counting the sift. */
export async function failSift(input: SiftInput, message: string): Promise<StepOutcome> {
  const repos = getRepos();
  await repos.aiRuns.setStatus(input.userId, input.accountingRunId, "failed", message);
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  const failed = await repos.tasks.update(
    input.userId,
    input.taskId,
    { aiStatus: "failed", aiError: SIFT_FAILED_MESSAGE, aiAttempts: task.aiAttempts + 1 },
    { ifSiftId: input.siftId },
  );
  return failed ? "applied" : "superseded";
}

/** Provider detail stays in `ai_runs`; the task gets a stable, retryable message. */
export const SIFT_FAILED_MESSAGE = "Sifting failed — try again.";

/**
 * Record the question as an open decision. Runs after the workflow has
 * registered the hook for `question.decisionId`, so an answer that lands
 * the moment the row appears finds a run to resume. Idempotent on retry:
 * the id is fixed, and `create` returns the existing row for the owner.
 */
export async function openDecision(
  input: SiftInput,
  question: PendingQuestion,
): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  await openClarifyingQuestion(repos, input.userId, {
    id: question.decisionId,
    taskId: input.taskId,
    siftId: input.siftId,
    question: question.question,
    options: question.options,
    confidence: question.confidence,
  });
  console.log(`[workflow] sift ${input.siftId}: asked "${question.question}"`);
  return "applied";
}

/**
 * Fold the user's answer into the capture so every stage of the second
 * pass sees it, and put the task back into `running` for the watcher.
 */
export async function foldAnswer(input: SiftInput, answer: DecisionAnswer): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  const folded = await repos.tasks.update(
    input.userId,
    input.taskId,
    {
      sourceContext: withAnswer(task.sourceContext, answerText(answer)),
      clarifyingQuestion: null,
      aiStatus: "running",
      aiError: null,
      siftStage: "enrich",
      siftedWithAssumptions: false,
    },
    { ifSiftId: input.siftId },
  );
  return folded ? "applied" : "superseded";
}

/**
 * `sourceContext` with the answer appended as an `Answer:` line. Idempotent:
 * the route writes the line before waking the run and the run's fold step
 * writes it again, so an identical trailing line is not repeated.
 */
export function withAnswer(sourceContext: string | null, answer: string): string {
  const line = `Answer: ${answer.trim()}`;
  const existing = sourceContext?.trim() ?? "";
  if (existing === line || existing.endsWith(`\n${line}`)) return existing;
  const next = existing ? `${existing}\n\n${line}` : line;
  return next.length > TASK_LIMITS.sourceContext ? next.slice(-TASK_LIMITS.sourceContext) : next;
}

/**
 * The deadline fired. Close the decision as `expired` unless the user got
 * there first: the deadline and the answer can race, and when the CAS
 * loses to an answer the run must still carry that answer through the
 * second pass instead of ending with the task parked on `pending`.
 */
export async function expireDecision(
  input: SiftInput,
  decisionId: string,
): Promise<DecisionResolutionPayload> {
  const repos = getRepos();
  const resolved = await repos.decisions.resolve(input.userId, decisionId, {
    status: "expired",
    answer: null,
  });
  if (resolved) {
    console.log(`[workflow] sift ${input.siftId}: question expired unanswered`);
    return { status: "expired" };
  }
  const current = await repos.decisions.get(input.userId, decisionId);
  if (current?.status === "answered" && current.answer) {
    return { status: "answered", answer: current.answer };
  }
  return { status: current?.status === "dismissed" ? "dismissed" : "expired" };
}

async function owned(repos: Repos, input: SiftInput): Promise<Task | "missing" | "superseded"> {
  const task = await repos.tasks.get(input.userId, input.taskId);
  if (!task) return "missing";
  if (task.siftId !== input.siftId) return "superseded";
  return task;
}

export async function buildSiftContext(
  repos: Repos,
  userId: string,
  task: Task,
): Promise<SiftContext> {
  const [labels, memories, tasks] = await Promise.all([
    repos.labels.list(userId, { limit: RECENT_LABELS_IN_CONTEXT }),
    repos.memories.list(userId, { pinned: true, limit: AI_CONTEXT_LIMITS.maxPreferences }),
    // +1 so the task being sifted, when it is itself open, does not cost a slot.
    repos.tasks.list(userId, { lifecycles: OPEN_LIFECYCLES, limit: OPEN_TASKS_IN_CONTEXT + 1 }),
  ]);
  const openTasks: OpenTaskSummary[] = tasks
    .filter((t) => t.id !== task.id)
    .slice(0, OPEN_TASKS_IN_CONTEXT)
    .map((t) => ({
      title: t.title,
      lifecycle: t.lifecycle,
      due: t.due,
      urgency: t.urgency,
      importance: t.importance,
      effort: t.effort,
    }));
  return {
    task,
    todayIso: new Date().toISOString().slice(0, 10),
    recentLabels: labels.map((l) => l.name),
    preferences: memories.map((m) => m.text),
    openTasks,
  };
}

const OPEN_LIFECYCLES: readonly Task["lifecycle"][] = ["inbox", "active", "waiting"];
