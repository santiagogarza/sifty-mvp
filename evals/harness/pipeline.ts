import { stagePatch } from "@/lib/ai/sift/apply";
import { runStage } from "@/lib/ai/sift/run-stage";
import { STAGE_DEFINITIONS, type StageOutputs } from "@/lib/ai/sift/stages";
import type { TriageMeta } from "@/lib/ai/triage-agent";
import { SIFT_STAGES, type SiftStage, type Task } from "@/lib/domain/types";
import type { GoldenCapture, GoldenSet } from "../golden/schema";
import { contextFor, taskFromCapture } from "./context";
import type { EvalMode } from "./mode";

/**
 * Runs the five sift stages for one capture the way `siftTask` does: each
 * stage sees the task as the previous stages left it (`stagePatch`), so the
 * prioritize prompt reads the enriched title and the plan prompt reads the
 * subtasks. Storage, labels, and billing are out of scope here; the step
 * bodies in `execute-stage.ts` own those and have their own tests.
 */

export interface StageRun<S extends SiftStage = SiftStage> {
  stage: S;
  /** Parsed output, or null when the stage threw (schema miss, provider error). */
  output: StageOutputs[S] | null;
  meta: TriageMeta | null;
  error: string | null;
  /** System + user prompt length, for the offline cost estimate. */
  promptChars: number;
  /** JSON length of the output, for the offline cost estimate. */
  outputChars: number;
}

export interface CaptureResult {
  capture: GoldenCapture;
  stages: { [S in SiftStage]: StageRun<S> };
  /** The task after every stage was applied. */
  task: Task;
}

export async function runCapture(
  capture: GoldenCapture,
  set: GoldenSet,
  mode: EvalMode,
): Promise<CaptureResult> {
  let task = taskFromCapture(capture, set.today);
  const stages = {} as CaptureResult["stages"];

  for (const stage of SIFT_STAGES) {
    const ctx = contextFor(capture, task, set.today);
    const def = STAGE_DEFINITIONS[stage];
    const promptChars = def.system.length + def.user(ctx).length;
    try {
      const { output, meta } = await runStage(stage, ctx, { offline: mode.offline });
      assignStage(stages, stage, {
        stage,
        output,
        meta,
        error: null,
        promptChars,
        outputChars: JSON.stringify(output).length,
      });
      task = { ...task, ...stagePatch(task, stage, output) };
    } catch (err) {
      assignStage(stages, stage, {
        stage,
        output: null,
        meta: null,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        promptChars,
        outputChars: 0,
      });
    }
  }

  return { capture, stages, task };
}

function assignStage<S extends SiftStage>(
  stages: CaptureResult["stages"],
  stage: S,
  run: StageRun<S>,
): void {
  (stages as Record<SiftStage, StageRun>)[stage] = run;
}

export async function runGoldenSet(set: GoldenSet, mode: EvalMode): Promise<CaptureResult[]> {
  const captures = mode.only
    ? set.captures.filter((c) => c.id.startsWith(mode.only!))
    : set.captures;
  const results: CaptureResult[] = new Array(captures.length);
  const concurrency = mode.offline ? 1 : mode.concurrency;
  let next = 0;

  async function worker() {
    while (next < captures.length) {
      const index = next++;
      results[index] = await runCapture(captures[index]!, set, mode);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, captures.length) }, worker));
  return results;
}
