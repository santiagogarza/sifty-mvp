import { readFileSync } from "node:fs";
import path from "node:path";
import type { GoldenCapture } from "@/evals/golden/schema";
import {
  type CostBaseline,
  type CostSummary,
  DRIFT_TOLERANCE,
  PIPELINE_CEILING_CENTS,
  compareCosts,
  registryPrices,
  relativeDrift,
  summarizeCosts,
} from "@/evals/harness/cost";
import { compareFingerprints, computeFingerprints } from "@/evals/harness/fingerprints";
import type { CaptureResult } from "@/evals/harness/pipeline";
import { MODELS, estimateCostCents, resolveStageRoute } from "@/lib/ai/models";
import { STAGE_DEFINITIONS } from "@/lib/ai/sift/stages";
import { SIFT_STAGES, type SiftStage } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

const capture: GoldenCapture = {
  id: "c",
  category: "work",
  sourceText: "x",
  sourceContext: null,
  recentLabels: [],
  preferences: [],
  openTasks: [],
  expect: {},
};

function result(opts: {
  promptChars: number;
  outputChars: number;
  tokens?: [number, number];
}): CaptureResult {
  const stages = {} as CaptureResult["stages"];
  for (const stage of SIFT_STAGES) {
    const primary = resolveStageRoute(stage).primary;
    const [inputTokens, outputTokens] = opts.tokens ?? [null, null];
    (stages as Record<SiftStage, unknown>)[stage] = {
      stage,
      output: {},
      error: null,
      promptChars: opts.promptChars,
      outputChars: opts.outputChars,
      meta: opts.tokens
        ? {
            promptVersion: STAGE_DEFINITIONS[stage].promptVersion,
            stage,
            model: primary,
            transport: "gateway",
            durationMs: 1,
            inputTokens,
            outputTokens,
            costCents: estimateCostCents({ model: MODELS[primary], inputTokens, outputTokens }),
            offline: false,
          }
        : null,
    };
  }
  return { capture, stages, task: {} as CaptureResult["task"] };
}

describe("summarizeCosts", () => {
  it("estimates offline from prompt and output length at the stage's registry price", () => {
    const summary = summarizeCosts([result({ promptChars: 400, outputChars: 80 })], true);
    expect(summary.kind).toBe("estimated");
    const enrich = summary.stages.enrich;
    expect(enrich.model).toBe("anthropic/claude-haiku-4.5");
    expect(enrich.inputTokens).toBe(100);
    expect(enrich.outputTokens).toBe(20);
    expect(enrich.costCents).toBeCloseTo(
      estimateCostCents({ model: MODELS[enrich.model], inputTokens: 100, outputTokens: 20 })!,
      6,
    );
    expect(summary.stages.plan.model).toBe("anthropic/claude-sonnet-4.5");
    expect(summary.stages.plan.costCents).toBeGreaterThan(enrich.costCents);
    expect(summary.pipelineCostCents).toBeCloseTo(
      SIFT_STAGES.reduce((n, s) => n + summary.stages[s].costCents, 0),
      6,
    );
  });

  it("averages measured usage online and skips stages without usage", () => {
    const summary = summarizeCosts(
      [
        result({ promptChars: 1, outputChars: 1, tokens: [1000, 100] }),
        result({ promptChars: 1, outputChars: 1 }),
      ],
      false,
    );
    expect(summary.kind).toBe("measured");
    expect(summary.stages.enrich.samples).toBe(1);
    expect(summary.stages.enrich.inputTokens).toBe(1000);
    expect(summary.stages.enrich.costCents).toBeCloseTo(
      estimateCostCents({
        model: MODELS["anthropic/claude-haiku-4.5"],
        inputTokens: 1000,
        outputTokens: 100,
      })!,
      6,
    );
  });
});

describe("compareCosts", () => {
  const current = summarizeCosts([result({ promptChars: 400, outputChars: 80 })], true);
  const baseline: CostBaseline = { prices: registryPrices(), estimated: current, measured: null };

  it("is silent when nothing moved", () => {
    expect(compareCosts(current, baseline)).toEqual([]);
  });

  it("warns on registry price changes", () => {
    const prices = registryPrices();
    prices["anthropic/claude-haiku-4.5"] = { input: 0.8, output: 4 };
    const warnings = compareCosts(current, { ...baseline, prices });
    expect(warnings.map((w) => w.code)).toEqual(["price-changed"]);
    expect(warnings[0]!.message).toContain("$0.8→$1");
  });

  it("warns past the drift tolerance on a stage and on the pipeline", () => {
    const grown = summarizeCosts(
      [
        result({
          promptChars: 400 * (1 + DRIFT_TOLERANCE + 0.1),
          outputChars: 80 * (1 + DRIFT_TOLERANCE + 0.1),
        }),
      ],
      true,
    );
    const codes = compareCosts(grown, baseline).map((w) => w.code);
    expect(codes).toContain("stage-drift");
    expect(codes).toContain("pipeline-drift");
    expect(codes).not.toContain("price-changed");
  });

  it("asks for a baseline when the mode has none, and flags the absolute ceiling", () => {
    const measured: CostSummary = { ...current, kind: "measured" };
    expect(compareCosts(measured, baseline).map((w) => w.code)).toEqual(["no-baseline"]);

    const huge = summarizeCosts([result({ promptChars: 4_000_000, outputChars: 400_000 })], true);
    expect(huge.pipelineCostCents).toBeGreaterThan(PIPELINE_CEILING_CENTS);
    expect(compareCosts(huge, baseline).map((w) => w.code)).toContain("pipeline-ceiling");
  });

  it("relativeDrift is signed and handles zero", () => {
    expect(relativeDrift(1, 1.5)).toBeCloseTo(0.5);
    expect(relativeDrift(2, 1)).toBeCloseTo(-0.5);
    expect(relativeDrift(0, 0)).toBe(0);
    expect(relativeDrift(0, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("prompt fingerprints", () => {
  const current = computeFingerprints();

  it("covers every stage prompt, the single-shot triage prompt, and the brief prompt", () => {
    for (const stage of SIFT_STAGES) {
      expect(current).toHaveProperty(STAGE_DEFINITIONS[stage].promptVersion);
    }
    expect(current).toHaveProperty("triage.v1");
    expect(current).toHaveProperty("brief.v1");
    expect(new Set(Object.values(current)).size).toBe(Object.keys(current).length);
  });

  it("matches the committed baseline (bump the version and run pnpm eval:update when a prompt changes)", () => {
    const recorded = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "evals/baselines/prompt-fingerprints.json"), "utf8"),
    );
    expect(compareFingerprints(current, recorded)).toEqual([]);
  });

  it("reports a moved hash and an unrecorded version", () => {
    const enrichVersion = STAGE_DEFINITIONS.enrich.promptVersion;
    const { "plan.v1": _unrecorded, ...rest } = current;
    const recorded = { ...rest, [enrichVersion]: "stale" };
    const findings = compareFingerprints(current, recorded);
    expect(findings.map((f) => [f.version, f.kind])).toEqual(
      expect.arrayContaining([
        [enrichVersion, "changed-without-bump"],
        ["plan.v1", "unrecorded"],
      ]),
    );
    expect(findings).toHaveLength(2);
    expect(compareFingerprints({ "Enrich V1": "x" }, {})[0]!.kind).toBe("bad-version");
  });
});
