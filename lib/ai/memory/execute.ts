import { type Repos, getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { FatalError } from "workflow";
import { recordAiRun } from "../ai-runs";
import { AiConfigError } from "../provider";
import type { TriageMeta } from "../triage-agent";
import { MEMORY_STAGE, type MemoryContext, type SiftContradiction } from "./extract";
import { looksMemoryWorthy } from "./prefilter";
import { filterProposals, proposeMemories } from "./propose";
import { failedMemoryMeta, runMemoryExtraction } from "./run";

/**
 * The body of the memory-extraction step, shared by the `siftTask`
 * pipeline (after `plan`) and the edit-triggered `memoryFromEdit`
 * workflow. Free of workflow directives so it unit-tests against the
 * in-memory repos with a mocked model.
 *
 * Cost control: a sift-triggered run only calls the model when the
 * capture looks like it carries something durable (`looksMemoryWorthy`);
 * its `ai_runs` row carries the task's `siftId`, a detail row of that sift
 * (one cap unit covers the whole pipeline). An edit-triggered run passes
 * `admitAiRun` in the route, fires at most once per task and sift, and is
 * billed as its own unit (`siftId` null), so the cap sees it.
 */

export interface MemoryExtractInput {
  userId: string;
  taskId: string;
  /** The sift whose output is being read (or contradicted). */
  siftId: string;
  trigger: "sift" | "edit";
  contradictions: SiftContradiction[];
  modelPreference: string | null;
  offline: boolean;
  /**
   * Edit-triggered runs: the `ai_runs` row reserved at admission, completed
   * in place here so a retried step never bills twice. Sift-triggered runs
   * insert their own detail row instead.
   */
  aiRunId?: string;
}

export type MemoryExtractOutcome =
  | { outcome: "proposed"; proposals: number; filed: number }
  | { outcome: "skipped"; reason: "missing" | "superseded" | "prefilter" | "nothing" };

/** Existing memories the prompt sees, newest first. */
export const EXISTING_MEMORIES_IN_CONTEXT = 50;

export async function extractMemories(
  input: MemoryExtractInput,
  workflowRunId: string | null,
): Promise<MemoryExtractOutcome> {
  const repos = getRepos();
  const release = async (why: string) => {
    if (input.aiRunId) await repos.aiRuns.setStatus(input.userId, input.aiRunId, "failed", why);
  };
  const task = await repos.tasks.get(input.userId, input.taskId);
  if (!task) {
    await release("task gone");
    return { outcome: "skipped", reason: "missing" };
  }
  if (task.siftId !== input.siftId) {
    await release("superseded by a newer sift");
    return { outcome: "skipped", reason: "superseded" };
  }

  const text = `${task.sourceText}\n${task.sourceContext ?? ""}`;
  if (input.trigger === "sift" && !looksMemoryWorthy(text)) {
    return { outcome: "skipped", reason: "prefilter" };
  }

  // Pinned notes are what the user lets models see (same rule as sift,
  // plan, and brief); the unpinned rest is read only for local dedupe and
  // never leaves the box.
  const [pinned, existing] = await Promise.all([
    repos.memories.list(input.userId, { pinned: true, limit: EXISTING_MEMORIES_IN_CONTEXT }),
    repos.memories.list(input.userId, { limit: EXISTING_MEMORIES_IN_CONTEXT }),
  ]);
  const ctx: MemoryContext = {
    task,
    trigger: input.trigger,
    contradictions: input.contradictions,
    existing: pinned.map((m) => ({ text: m.text, kind: m.kind })),
    todayIso: new Date().toISOString().slice(0, 10),
  };

  try {
    const { output, meta } = await runMemoryExtraction(ctx, {
      modelPreference: input.modelPreference,
      offline: input.offline,
    });
    await recordRun(repos, input, meta, "succeeded", null, workflowRunId);
    const proposals = filterProposals(output.proposals, existing);
    if (!proposals.length) return { outcome: "skipped", reason: "nothing" };
    const { filed } = await proposeMemories(repos, input.userId, proposals, {
      taskId: input.taskId,
      siftId: input.siftId,
      trigger: input.trigger,
    });
    console.log(
      `[workflow] memory ${input.siftId}: ${proposals.length} proposal(s), ${filed} filed (${meta.model})`,
    );
    return { outcome: "proposed", proposals: proposals.length, filed };
  } catch (err) {
    const message = err instanceof Error ? err.message : `${MEMORY_STAGE} failed`;
    reportError(err, {
      area: "memory.extract",
      userId: input.userId,
      tags: { taskId: input.taskId, siftId: input.siftId, trigger: input.trigger },
    });
    await recordRun(
      repos,
      input,
      failedMemoryMeta(input.offline),
      "failed",
      message,
      workflowRunId,
    );
    if (err instanceof AiConfigError) throw new FatalError(message);
    throw err;
  }
}

/**
 * Sift-triggered runs insert a detail row of their sift (not a cap unit).
 * Edit-triggered runs complete the row reserved at admission in place, so
 * the cap counted it before the model was called and a retry cannot add
 * a second unit.
 */
async function recordRun(
  repos: Repos,
  input: MemoryExtractInput,
  meta: TriageMeta,
  status: "succeeded" | "failed",
  error: string | null,
  workflowRunId: string | null,
): Promise<void> {
  if (input.aiRunId) {
    await repos.aiRuns.complete(input.userId, input.aiRunId, {
      promptVersion: meta.promptVersion,
      model: meta.model,
      transport: meta.transport,
      status,
      durationMs: meta.durationMs,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costCents: meta.costCents,
      offline: meta.offline,
      workflowRunId,
      error,
    });
    return;
  }
  await recordAiRun({
    userId: input.userId,
    taskId: input.taskId,
    meta,
    status,
    error,
    siftId: input.siftId,
    workflowRunId,
  });
}
