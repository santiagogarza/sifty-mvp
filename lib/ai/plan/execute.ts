import { getRepos } from "@/lib/db/repos";
import type { DailyPlanTrigger } from "@/lib/db/repos/types";
import { reportError } from "@/lib/observability/report-error";
import { FatalError } from "workflow";
import { AiConfigError } from "../provider";
import { applyDailyPlan } from "./apply";
import { buildPlanContext } from "./context";
import { failedPlanMeta, runDailyPlanModel } from "./run";
import type { DailyPlanOutput } from "./stage";

/**
 * Step bodies of the `dailyPlan` workflow, free of workflow directives so
 * they unit-test against the in-memory repos with a mocked model.
 *
 * Two steps, split where the money is: `decideDailyPlan` reads the bounded
 * context and calls the model once; `applyDailyPlanStep` writes the moves.
 * The plan's single `ai_runs` row (stage `prioritize`, the billing unit)
 * is reserved by the enqueue path before `start()` and *completed* here
 * with the model's usage, so a retried decide step updates the same row
 * instead of billing a second sift. Decisions travel to the apply step
 * with the alias → task id map the prompt was rendered with: an alias
 * only ever resolves to the task the model saw under it, never to a
 * re-ranked list.
 */

export interface DailyPlanInput {
  userId: string;
  /** The claimed `daily_plans` row. */
  planId: string;
  /** The reserved `prioritize` `ai_runs` row (one per run). */
  aiRunId: string;
  /** Local `YYYY-MM-DD` the plan is for. */
  planDate: string;
  timeZone: string;
  trigger: DailyPlanTrigger;
  modelPreference: string | null;
  offline: boolean;
}

export interface PlanDecisionResult {
  output: DailyPlanOutput;
  /** Alias → task id, exactly as rendered in the prompt. */
  aliases: Record<string, string>;
  considered: number;
}

export type PlanOutcome =
  | { outcome: "completed"; moves: number }
  | { outcome: "skipped"; reason: "no_open_tasks" | "missing" };

export async function beginDailyPlan(
  input: DailyPlanInput,
  workflowRunId: string | null,
): Promise<"applied" | "missing"> {
  const repos = getRepos();
  const plan = await repos.dailyPlans.update(input.userId, input.planId, {
    status: "running",
    workflowRunId,
  });
  return plan ? "applied" : "missing";
}

export async function decideDailyPlan(
  input: DailyPlanInput,
  workflowRunId: string | null,
): Promise<PlanDecisionResult | { skipped: "no_open_tasks" }> {
  const repos = getRepos();
  const ctx = await buildPlanContext(repos, input.userId, input.planDate, input.timeZone);
  if (ctx.candidates.length === 0) return { skipped: "no_open_tasks" };

  try {
    const { output, meta } = await runDailyPlanModel(ctx, {
      modelPreference: input.modelPreference,
      offline: input.offline,
    });
    await repos.aiRuns.complete(input.userId, input.aiRunId, {
      promptVersion: meta.promptVersion,
      model: meta.model,
      transport: meta.transport,
      status: "succeeded",
      durationMs: meta.durationMs,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      costCents: meta.costCents,
      offline: meta.offline,
      workflowRunId,
      error: null,
    });
    console.log(
      `[workflow] plan ${input.planId}: ${output.decisions.length} decisions over ${ctx.considered} tasks (${meta.model})`,
    );
    return {
      output,
      aliases: Object.fromEntries(ctx.candidates.map((c) => [c.alias, c.task.id])),
      considered: ctx.considered,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "daily plan failed";
    reportError(err, {
      area: "plan.decide",
      userId: input.userId,
      tags: { planId: input.planId, planDate: input.planDate, offline: input.offline },
    });
    const meta = failedPlanMeta(input.offline);
    await repos.aiRuns.complete(input.userId, input.aiRunId, {
      model: meta.model,
      transport: meta.transport,
      status: "failed",
      durationMs: 0,
      inputTokens: null,
      outputTokens: null,
      costCents: null,
      workflowRunId,
      error: message,
    });
    if (err instanceof AiConfigError) throw new FatalError(message);
    throw err;
  }
}

export async function applyDailyPlanStep(
  input: DailyPlanInput,
  decision: PlanDecisionResult,
): Promise<PlanOutcome> {
  const repos = getRepos();
  const { moves, skipped } = await applyDailyPlan(
    repos,
    input.userId,
    { planDate: input.planDate, aliases: decision.aliases },
    decision.output,
    { planId: input.planId },
  );
  if (skipped.length) {
    console.log(
      `[workflow] plan ${input.planId}: skipped ${skipped.map((s) => `${s.alias} (${s.why})`).join(", ")}`,
    );
  }
  const finished = await repos.dailyPlans.update(input.userId, input.planId, {
    status: "completed",
    summary: decision.output.summary,
    moves,
    considered: decision.considered,
    error: null,
    finishedAt: new Date().toISOString(),
  });
  if (!finished) return { outcome: "skipped", reason: "missing" };
  console.log(`[workflow] plan ${input.planId}: completed with ${moves.length} moves`);
  return { outcome: "completed", moves: moves.length };
}

export async function skipDailyPlan(
  input: DailyPlanInput,
  reason: "no_open_tasks",
): Promise<PlanOutcome> {
  const repos = getRepos();
  // Nothing was asked of the model, so nothing is billed.
  await repos.aiRuns.setStatus(input.userId, input.aiRunId, "failed", "no open tasks to plan");
  await repos.dailyPlans.update(input.userId, input.planId, {
    status: "completed",
    summary: NO_OPEN_TASKS_SUMMARY,
    moves: [],
    considered: 0,
    finishedAt: new Date().toISOString(),
  });
  return { outcome: "skipped", reason };
}

export const NO_OPEN_TASKS_SUMMARY =
  "Nothing open to plan. Capture something and Sifty will take it from there.";
export const PLAN_FAILED_MESSAGE = "Planning failed — try again.";

export async function failDailyPlan(input: DailyPlanInput, message: string): Promise<void> {
  const repos = getRepos();
  await repos.aiRuns.setStatus(input.userId, input.aiRunId, "failed", message.slice(0, 500));
  await repos.dailyPlans.update(input.userId, input.planId, {
    status: "failed",
    error: message.slice(0, 500),
    finishedAt: new Date().toISOString(),
  });
}
