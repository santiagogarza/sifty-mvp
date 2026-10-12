import { getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { FatalError } from "workflow";
import { recordAiRun } from "../ai-runs";
import { AiConfigError } from "../provider";
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
  const task = await repos.tasks.get(input.userId, input.taskId);
  if (!task) return { outcome: "skipped", reason: "missing" };
  if (task.siftId !== input.siftId) return { outcome: "skipped", reason: "superseded" };

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
    await recordAiRun({
      userId: input.userId,
      taskId: input.taskId,
      meta,
      status: "succeeded",
      siftId: billingSiftId(input),
      workflowRunId,
    });
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
    await recordAiRun({
      userId: input.userId,
      taskId: input.taskId,
      meta: failedMemoryMeta(input.offline),
      status: "failed",
      error: message,
      siftId: billingSiftId(input),
      workflowRunId,
    });
    if (err instanceof AiConfigError) throw new FatalError(message);
    throw err;
  }
}

/** Sift-triggered rows belong to their sift; edit-triggered rows are their own cap unit. */
function billingSiftId(input: MemoryExtractInput): string | null {
  return input.trigger === "sift" ? input.siftId : null;
}
