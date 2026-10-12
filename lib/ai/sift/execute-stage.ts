import { type Repos, getRepos } from "@/lib/db/repos";
import { AI_CONTEXT_LIMITS } from "@/lib/domain/limits";
import type { SiftStage, Task } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
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

/** How many of the user's other open tasks the prioritize prompt sees. */
export const OPEN_TASKS_IN_CONTEXT = 25;
const RECENT_LABELS_IN_CONTEXT = 8;

export async function beginSift(input: SiftInput): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  await repos.tasks.update(input.userId, input.taskId, {
    aiStatus: "running",
    aiError: null,
    siftStage: "enrich",
  });
  return "applied";
}

export async function executeSiftStage(
  input: SiftInput,
  stage: SiftStage,
  workflowRunId: string | null,
): Promise<StepOutcome> {
  const repos = getRepos();
  const task = await owned(repos, input);
  if (typeof task === "string") return task;

  await repos.tasks.update(input.userId, input.taskId, { aiStatus: "running", siftStage: stage });
  const ctx = await buildSiftContext(repos, input.userId, task);

  try {
    const { output, meta } = await runStage(stage, ctx, {
      modelPreference: input.modelPreference,
      offline: input.offline,
    });

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
      return fresh;
    }

    const patch = stagePatch(fresh, stage, output, { labelIds });
    await repos.tasks.update(input.userId, input.taskId, patch);
    await recordAiRun({
      userId: input.userId,
      taskId: input.taskId,
      meta,
      status: "succeeded",
      siftId: input.siftId,
      workflowRunId,
    });
    console.log(`[workflow] sift ${input.siftId}: ${stage} applied (${meta.model})`);
    return "applied";
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
  await repos.tasks.update(input.userId, input.taskId, {
    aiStatus: "ready",
    aiError: null,
    siftStage: null,
    aiAttempts: task.aiAttempts + 1,
  });
  console.log(`[workflow] sift ${input.siftId}: ready`);
  return "applied";
}

/** Terminal failure: surface it on the task and stop counting the sift. */
export async function failSift(input: SiftInput, message: string): Promise<StepOutcome> {
  const repos = getRepos();
  await repos.aiRuns.setStatus(input.userId, input.accountingRunId, "failed", message);
  const task = await owned(repos, input);
  if (typeof task === "string") return task;
  await repos.tasks.update(input.userId, input.taskId, {
    aiStatus: "failed",
    aiError: SIFT_FAILED_MESSAGE,
    aiAttempts: task.aiAttempts + 1,
  });
  return "applied";
}

/** Provider detail stays in `ai_runs`; the task gets a stable, retryable message. */
export const SIFT_FAILED_MESSAGE = "Sifting failed — try again.";

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
    repos.labels.list(userId),
    repos.memories.list(userId),
    repos.tasks.list(userId),
  ]);
  const openTasks: OpenTaskSummary[] = tasks
    .filter((t) => t.id !== task.id && OPEN_LIFECYCLES.has(t.lifecycle))
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
    recentLabels: labels.slice(0, RECENT_LABELS_IN_CONTEXT).map((l) => l.name),
    preferences: memories
      .filter((m) => m.pinned)
      .slice(0, AI_CONTEXT_LIMITS.maxPreferences)
      .map((m) => m.text),
    openTasks,
  };
}

const OPEN_LIFECYCLES = new Set<Task["lifecycle"]>(["inbox", "active", "waiting"]);
