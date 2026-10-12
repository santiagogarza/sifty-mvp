import {
  type PendingQuestion,
  type SiftInput,
  type StepOutcome,
  type TriageStepResult,
  beginSift,
  executeSiftStage,
  executeTriageStage,
  expireDecision,
  failSift,
  finishSift,
  foldAnswer,
  openDecision,
} from "@/lib/ai/sift/execute-stage";
import {
  DECISION_TTL_MS,
  type DecisionResolutionPayload,
  decisionHookToken,
} from "@/lib/decisions/hook";
import type { DecisionAnswer } from "@/lib/domain/types";
import { createHook, getWorkflowMetadata, sleep } from "workflow";
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
 * Clarifying questions: when triage is unsure it asks one question. The
 * pipeline still runs to the end, opens a `clarifying_question` decision,
 * marks the task `ready` (usable, with Sifty's best guess), then suspends
 * on the decision's hook with no compute for up to `DECISION_TTL_MS`. The
 * decision exists before the task reads `ready`, so a client that refreshes
 * its inbox when the sift settles always finds the question. An answer wakes
 * the run, which folds it into the capture and runs every stage again
 * inside the same sift (one cap unit, no second question). A dismissal or
 * the deadline ends the run; the Decisions service already marked the
 * task "sifted with assumptions" or the decision expired.
 *
 * Per-user concurrency: at most `SIFT_SLOTS_PER_USER` sifts run at once
 * per account, so the prioritize stage sees a settled list and one user
 * cannot monopolize the queue. The slot is released while the run waits
 * on the human and re-acquired for the second pass.
 */
export const SIFT_SLOTS_PER_USER = 2;

export type SiftOutcome =
  | { outcome: "completed"; decision?: "answered" | "dismissed" | "expired" }
  | { outcome: "superseded"; at: string }
  | { outcome: "missing"; at: string };

export async function siftTask(input: SiftInput): Promise<SiftOutcome> {
  "use workflow";
  let slot = await acquireUserSlot("sift", input.userId, SIFT_SLOTS_PER_USER);
  const { workflowRunId } = getWorkflowMetadata();
  console.log(`[workflow] sift ${input.siftId}: start task ${input.taskId} (${workflowRunId})`);

  try {
    const began = await beginStep(input);
    if (began !== "applied") return { outcome: began, at: "begin" };

    const first = await runPass(input, workflowRunId, { askQuestions: true });
    if (first.outcome !== "applied") return first;
    if (!first.question) {
      const finished = await finishStep(input);
      if (finished !== "applied") return { outcome: finished, at: "finish" };
      return { outcome: "completed" };
    }

    // Register the hook before the decision exists, so an answer that
    // lands the instant the inbox shows it already has a run to resume;
    // and open the decision before the task reads `ready`, so a client
    // that refreshes its inbox when the sift settles finds the question.
    const hook = createHook<DecisionResolutionPayload>({
      token: decisionHookToken(first.question.decisionId),
    });
    await hook.getConflict();
    const opened = await openDecisionStep(input, first.question);
    if (opened !== "applied") return { outcome: opened, at: "decision" };
    const finished = await finishStep(input);
    if (finished !== "applied") return { outcome: finished, at: "finish" };

    slot.release();
    let resolution = await Promise.race([hook, deadline(DECISION_TTL_MS)]);
    if (resolution.status === "expired") {
      // The deadline won the race, but the user may have answered in the
      // same instant: the step reports what the row actually says.
      resolution = await expireDecisionStep(input, first.question.decisionId);
    }
    if (resolution.status !== "answered") {
      return { outcome: "completed", decision: resolution.status };
    }

    slot = await acquireUserSlot("sift", input.userId, SIFT_SLOTS_PER_USER);
    const folded = await foldAnswerStep(input, resolution.answer);
    if (folded !== "applied") return { outcome: folded, at: "fold" };
    const second = await runPass(input, workflowRunId, { askQuestions: false });
    if (second.outcome !== "applied") return second;
    const done = await finishStep(input);
    if (done !== "applied") return { outcome: done, at: "finish" };
    return { outcome: "completed", decision: "answered" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] sift ${input.siftId}: failed — ${message}`);
    await failStep(input, message);
    throw err;
  }
}

type PassResult =
  | { outcome: "applied"; question: PendingQuestion | null }
  | { outcome: "superseded"; at: string }
  | { outcome: "missing"; at: string };

/** One run through the five stages; the caller finishes the sift. */
async function runPass(
  input: SiftInput,
  workflowRunId: string,
  opts: { askQuestions: boolean },
): Promise<PassResult> {
  const enriched = await enrichStep(input, workflowRunId);
  if (enriched !== "applied") return { outcome: enriched, at: "enrich" };
  const prioritized = await prioritizeStep(input, workflowRunId);
  if (prioritized !== "applied") return { outcome: prioritized, at: "prioritize" };
  const triaged = await triageStep(input, workflowRunId, opts);
  if (triaged.outcome !== "applied") return { outcome: triaged.outcome, at: "triage" };
  const split = await subtasksStep(input, workflowRunId);
  if (split !== "applied") return { outcome: split, at: "subtasks" };
  const planned = await planStep(input, workflowRunId);
  if (planned !== "applied") return { outcome: planned, at: "plan" };
  return { outcome: "applied", question: triaged.question };
}

/** Resolves like an expired hook after `ms`, so the wait is bounded. */
async function deadline(ms: number): Promise<DecisionResolutionPayload> {
  await sleep(ms);
  return { status: "expired" };
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

async function triageStep(
  input: SiftInput,
  runId: string,
  opts: { askQuestions: boolean },
): Promise<TriageStepResult> {
  "use step";
  return executeTriageStage(input, runId, opts);
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

async function openDecisionStep(input: SiftInput, question: PendingQuestion): Promise<StepOutcome> {
  "use step";
  return openDecision(input, question);
}

async function foldAnswerStep(input: SiftInput, answer: DecisionAnswer): Promise<StepOutcome> {
  "use step";
  return foldAnswer(input, answer);
}

async function expireDecisionStep(
  input: SiftInput,
  decisionId: string,
): Promise<DecisionResolutionPayload> {
  "use step";
  return expireDecision(input, decisionId);
}

async function failStep(input: SiftInput, message: string): Promise<StepOutcome> {
  "use step";
  return failSift(input, message);
}
