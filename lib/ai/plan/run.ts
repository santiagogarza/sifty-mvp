import { generateObject } from "ai";
import { resolveProvider, usageFromResult } from "../provider";
import type { TriageMeta } from "../triage-agent";
import type { PlanContext } from "./context";
import {
  DAILY_PLAN_PROMPT_VERSION,
  DAILY_PLAN_STAGE,
  DAILY_PLAN_TEMPERATURE,
  DailyPlanOutput,
  dailyPlanSystem,
  dailyPlanUser,
  offlineDailyPlan,
} from "./stage";

/**
 * One model call for the whole plan, priced like any `prioritize` run.
 * Offline answers with the deterministic variant and never resolves a
 * provider. Pure with respect to storage; `execute.ts` applies and records.
 */

const HEURISTIC_MODEL = "sifty.local.heuristic";

export interface RunPlanOptions {
  modelPreference?: string | null;
  offline: boolean;
}

export async function runDailyPlanModel(
  ctx: PlanContext,
  opts: RunPlanOptions,
): Promise<{ output: DailyPlanOutput; meta: TriageMeta }> {
  const start = Date.now();
  if (opts.offline) {
    return {
      output: offlineDailyPlan(ctx),
      meta: {
        promptVersion: DAILY_PLAN_PROMPT_VERSION,
        stage: DAILY_PLAN_STAGE,
        model: HEURISTIC_MODEL,
        transport: "offline",
        durationMs: Date.now() - start,
        inputTokens: null,
        outputTokens: null,
        costCents: null,
        offline: true,
      },
    };
  }

  const resolved = resolveProvider(DAILY_PLAN_STAGE, { preference: opts.modelPreference });
  const result = await generateObject({
    model: resolved.model,
    schema: DailyPlanOutput,
    schemaName: "DailyPlanOutput",
    schemaDescription: "A one-paragraph plan for the day plus priority changes, by task alias.",
    system: dailyPlanSystem(ctx),
    prompt: dailyPlanUser(ctx),
    temperature: DAILY_PLAN_TEMPERATURE,
  });
  const usage = usageFromResult(resolved, result);
  return {
    output: result.object,
    meta: {
      promptVersion: DAILY_PLAN_PROMPT_VERSION,
      stage: DAILY_PLAN_STAGE,
      model: usage.model,
      transport: resolved.transport,
      durationMs: Date.now() - start,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costCents: usage.costCents,
      offline: false,
    },
  };
}

export function failedPlanMeta(offline: boolean): TriageMeta {
  return {
    promptVersion: DAILY_PLAN_PROMPT_VERSION,
    stage: DAILY_PLAN_STAGE,
    model: "unknown",
    transport: offline ? "offline" : "unknown",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: null,
    offline,
  };
}
