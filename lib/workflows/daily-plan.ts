import {
  type DailyPlanInput,
  type PlanDecisionResult,
  type PlanOutcome,
  applyDailyPlanStep,
  beginDailyPlan,
  decideDailyPlan,
  failDailyPlan,
  skipDailyPlan,
} from "@/lib/ai/plan/execute";
import { getWorkflowMetadata } from "workflow";
import { acquireUserSlot } from "./user-lock";

/**
 * `dailyPlan` — re-rank Today/Focus across the user's whole open list.
 *
 *   begin → decide (bounded read + one model call) → apply (moves + events)
 *
 * Runs nightly per user from `/api/cron/daily-plan` and on demand from
 * "Re-plan today". One run per user at a time: the slot keeps a manual
 * re-plan from racing the nightly one, and the sift pipeline's own slots
 * are untouched because a plan skips tasks that are mid-sift.
 */
export const PLAN_SLOTS_PER_USER = 1;

export async function dailyPlan(input: DailyPlanInput): Promise<PlanOutcome> {
  "use workflow";
  await acquireUserSlot("plan", input.userId, PLAN_SLOTS_PER_USER);
  const { workflowRunId } = getWorkflowMetadata();
  console.log(
    `[workflow] plan ${input.planId}: start for ${input.userId} on ${input.planDate} (${workflowRunId})`,
  );

  try {
    const began = await beginStep(input, workflowRunId);
    if (began !== "applied") return { outcome: "skipped", reason: "missing" };

    const decided = await decideStep(input, workflowRunId);
    if ("skipped" in decided) return await skipStep(input, decided.skipped);

    return await applyStep(input, decided);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow] plan ${input.planId}: failed — ${message}`);
    await failStep(input, message);
    throw err;
  }
}

async function beginStep(input: DailyPlanInput, runId: string): Promise<"applied" | "missing"> {
  "use step";
  return beginDailyPlan(input, runId);
}

async function decideStep(
  input: DailyPlanInput,
  runId: string,
): Promise<PlanDecisionResult | { skipped: "no_open_tasks" }> {
  "use step";
  return decideDailyPlan(input, runId);
}

async function applyStep(
  input: DailyPlanInput,
  decision: PlanDecisionResult,
): Promise<PlanOutcome> {
  "use step";
  return applyDailyPlanStep(input, decision);
}

async function skipStep(input: DailyPlanInput, reason: "no_open_tasks"): Promise<PlanOutcome> {
  "use step";
  return skipDailyPlan(input, reason);
}

async function failStep(input: DailyPlanInput, message: string): Promise<void> {
  "use step";
  return failDailyPlan(input, message);
}
