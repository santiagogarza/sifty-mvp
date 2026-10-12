import {
  type KnownModelSlug,
  MODELS,
  MODEL_SLUGS,
  estimateCostCents,
  resolveStageRoute,
} from "@/lib/ai/models";
import { SIFT_STAGES, type SiftStage } from "@/lib/domain/types";
import type { CaptureResult } from "./pipeline";

/**
 * Cost regression check.
 *
 * Every number is priced from the registry (`MODELS[*].inputUsdPerMillion`
 * and friends), the same way `ai_runs.cost_cents` is, so the eval and the
 * admin cost page can never disagree about what a sift costs.
 *
 * Offline there are no token counts, so the estimate is prompt and output
 * length at ~4 characters per token against the stage's default primary
 * model. That is coarse, but it moves when a prompt grows or a stage is
 * re-routed to a pricier model, which is what a PR needs to hear about.
 * Online the provider's reported usage is used instead.
 *
 * Drift is reported as a warning, never a failure: a deliberately longer
 * prompt may be worth its price, and the nightly numbers are the ones
 * that matter for spend.
 */

export const CHARS_PER_TOKEN = 4;
/** Relative change in a stage's or the pipeline's cost that triggers a warning. */
export const DRIFT_TOLERANCE = 0.25;
/** Fractional cents per full sift above which the pipeline is flagged, regardless of baseline. */
export const PIPELINE_CEILING_CENTS = 3;

export interface StageCost {
  model: KnownModelSlug;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  samples: number;
}

export interface CostSummary {
  /** "estimated" offline, "measured" online. */
  kind: "estimated" | "measured";
  stages: Record<SiftStage, StageCost>;
  pipelineCostCents: number;
}

export interface CostBaseline {
  prices: Record<string, { input: number; output: number }>;
  estimated: CostSummary | null;
  measured: CostSummary | null;
}

export function registryPrices(): CostBaseline["prices"] {
  const prices: CostBaseline["prices"] = {};
  for (const slug of MODEL_SLUGS) {
    const spec = MODELS[slug];
    prices[slug] = { input: spec.inputUsdPerMillion, output: spec.outputUsdPerMillion };
  }
  return prices;
}

export function summarizeCosts(results: CaptureResult[], offline: boolean): CostSummary {
  const stages = {} as Record<SiftStage, StageCost>;
  let pipeline = 0;

  for (const stage of SIFT_STAGES) {
    const primary = resolveStageRoute(stage).primary;
    let input = 0;
    let output = 0;
    let cents = 0;
    let samples = 0;

    for (const result of results) {
      const run = result.stages[stage];
      if (offline) {
        if (run.output === null) continue;
        const inTokens = Math.ceil(run.promptChars / CHARS_PER_TOKEN);
        const outTokens = Math.ceil(run.outputChars / CHARS_PER_TOKEN);
        input += inTokens;
        output += outTokens;
        cents +=
          estimateCostCents({
            model: MODELS[primary],
            inputTokens: inTokens,
            outputTokens: outTokens,
          }) ?? 0;
        samples += 1;
      } else {
        const meta = run.meta;
        if (!meta || meta.inputTokens === null || meta.outputTokens === null) continue;
        input += meta.inputTokens;
        output += meta.outputTokens;
        cents += meta.costCents ?? 0;
        samples += 1;
      }
    }

    const avg = (n: number) => (samples ? n / samples : 0);
    const stageCost: StageCost = {
      model: primary,
      inputTokens: Math.round(avg(input)),
      outputTokens: Math.round(avg(output)),
      costCents: round6(avg(cents)),
      samples,
    };
    stages[stage] = stageCost;
    pipeline += stageCost.costCents;
  }

  return { kind: offline ? "estimated" : "measured", stages, pipelineCostCents: round6(pipeline) };
}

export interface CostWarning {
  code: "price-changed" | "stage-drift" | "pipeline-drift" | "pipeline-ceiling" | "no-baseline";
  message: string;
}

export function compareCosts(current: CostSummary, baseline: CostBaseline): CostWarning[] {
  const warnings: CostWarning[] = [];

  const now = registryPrices();
  for (const [slug, price] of Object.entries(now)) {
    const was = baseline.prices[slug];
    if (!was) {
      warnings.push({ code: "price-changed", message: `${slug} is new to the registry` });
    } else if (was.input !== price.input || was.output !== price.output) {
      warnings.push({
        code: "price-changed",
        message: `${slug} list price changed: in $${was.input}→$${price.input}, out $${was.output}→$${price.output} per 1M tokens`,
      });
    }
  }

  const reference = current.kind === "measured" ? baseline.measured : baseline.estimated;
  if (!reference) {
    warnings.push({
      code: "no-baseline",
      message: `no ${current.kind} cost baseline recorded yet; run with EVAL_UPDATE_BASELINES=1 to record this run (${current.pipelineCostCents.toFixed(4)}¢ per sift)`,
    });
  } else {
    for (const stage of SIFT_STAGES) {
      const was = reference.stages[stage];
      const is = current.stages[stage];
      if (!was || !is.samples) continue;
      if (was.model !== is.model) {
        warnings.push({
          code: "stage-drift",
          message: `${stage} now routes to ${is.model} (baseline ${was.model})`,
        });
      }
      const drift = relativeDrift(was.costCents, is.costCents);
      if (Math.abs(drift) > DRIFT_TOLERANCE) {
        warnings.push({
          code: "stage-drift",
          message: `${stage} ${current.kind} cost ${was.costCents.toFixed(4)}¢ → ${is.costCents.toFixed(4)}¢ (${formatPct(drift)}; ${was.inputTokens}+${was.outputTokens} → ${is.inputTokens}+${is.outputTokens} tokens)`,
        });
      }
    }
    const drift = relativeDrift(reference.pipelineCostCents, current.pipelineCostCents);
    if (Math.abs(drift) > DRIFT_TOLERANCE) {
      warnings.push({
        code: "pipeline-drift",
        message: `full sift ${current.kind} cost ${reference.pipelineCostCents.toFixed(4)}¢ → ${current.pipelineCostCents.toFixed(4)}¢ (${formatPct(drift)})`,
      });
    }
  }

  if (current.pipelineCostCents > PIPELINE_CEILING_CENTS) {
    warnings.push({
      code: "pipeline-ceiling",
      message: `full sift ${current.kind} cost ${current.pipelineCostCents.toFixed(4)}¢ exceeds the ${PIPELINE_CEILING_CENTS}¢ ceiling`,
    });
  }

  return warnings;
}

/** Signed relative change; +Infinity when a zero baseline becomes non-zero. */
export function relativeDrift(was: number, is: number): number {
  if (was === 0) return is === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (is - was) / was;
}

function formatPct(drift: number): string {
  return Number.isFinite(drift)
    ? `${drift >= 0 ? "+" : ""}${Math.round(drift * 100)}%`
    : "from zero";
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
