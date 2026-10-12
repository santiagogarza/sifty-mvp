import {
  type SiftInput,
  type StepOutcome,
  beginSift,
  executeSiftStage,
  failSift,
  finishSift,
} from "@/lib/ai/sift/execute-stage";
import { getWorkflowMetadata } from "workflow";
import { acquireUserSlot } from "./user-lock";

/**
 * `siftTask` — the durable sifting pipeline.
 *
 *   enrich → prioritize (list-aware) → triage → subtasks → plan
 *
 * Each stage is one step: it re-reads the task, calls the stage's model (or
 * the offline heuristic), writes its fields with `editedFields` protection,
 * and records an `ai_runs` row with `stage`, `prompt_version`, `sift_id`,
 * and `workflow_run_id`. Steps retry on transient errors; operator
 * misconfiguration is fatal. A re-sift or a delete supersedes the run at
 * the next step boundary.
 *
 * Per-user concurrency: at most `SIFT_SLOTS_PER_USER` sifts run at once
 * per account, so the prioritize stage sees a settled list and one user
 * cannot monopolize the queue.
 */
export const SIFT_SLOTS_PER_USER = 2;

export type SiftOutcome =
  | { outcome: "completed" }
  | { outcome: "superseded"; at: string }
  | { outcome: "missing"; at: string };

export async function siftTask(input: SiftInput): Promise<SiftOutcome> {
  "use workflow";
  await acquireUserSlot("sift", input.userId, SIFT_SLOTS_PER_USER);
  const { workflowRunId } = getWorkflowMetadata();
  console.log(`[workflow] sift ${input.siftId}: start task ${input.taskId} (${workflowRunId})`);

  try {
    const began = await beginStep(input);
    if (began !== "applied") return { outcome: began, at: "begin" };

    const enriched = await enrichStep(input, workflowRunId);
    if (enriched !== "applied") return { outcome: enriched, at: "enrich" };
    const prioritized = await prioritizeStep(input, workflowRunId);
    if (prioritized !== "applied") return { outcome: prioritized, at: "prioritize" };
    const triaged = await triageStep(input, workflowRunId);
    if (triaged !== "applied") return { outcome: triaged, at: "triage" };
    const split = await subtasksStep(input, workflowRunId);
    if (split !== "applied") return { outcome: split, at: "subtasks" };
    const planned = await planStep(input, workflowRunId);
    if (planned !== "applied") return { outcome: planned, at: "plan" };

    const finished = await finishStep(input);
    if (finished !== "applied") return { outcome: finished, at: "finish" };
    return { outcome: "completed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] sift ${input.siftId}: failed — ${message}`);
    await failStep(input, message);
    throw err;
  }
}

// One named step per stage so the dashboard reads enrich/prioritize/… instead
// of five identical entries.

async function beginStep(input: SiftInput): Promise<StepOutcome> {
  "use step";
  return beginSift(input);
}

async function enrichStep(input: SiftInput, runId: string): Promise<StepOutcome> {
  "use step";
  return executeSiftStage(input, "enrich", runId);
}

async function prioritizeStep(input: SiftInput, runId: string): Promise<StepOutcome> {
  "use step";
  return executeSiftStage(input, "prioritize", runId);
}

async function triageStep(input: SiftInput, runId: string): Promise<StepOutcome> {
  "use step";
  return executeSiftStage(input, "triage", runId);
}

async function subtasksStep(input: SiftInput, runId: string): Promise<StepOutcome> {
  "use step";
  return executeSiftStage(input, "subtasks", runId);
}

async function planStep(input: SiftInput, runId: string): Promise<StepOutcome> {
  "use step";
  return executeSiftStage(input, "plan", runId);
}

async function finishStep(input: SiftInput): Promise<StepOutcome> {
  "use step";
  return finishSift(input);
}

async function failStep(input: SiftInput, message: string): Promise<StepOutcome> {
  "use step";
  return failSift(input, message);
}
