import { MODELS } from "@/lib/ai/models";
import { SIFT_STAGES, type SiftStage } from "@/lib/domain/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadGoldenSet } from "./golden/schema";
import {
  type RubricBaseline,
  readCostBaseline,
  readRubricBaseline,
  writeCostBaseline,
  writeRubricBaseline,
} from "./harness/baselines";
import { type CostWarning, compareCosts, registryPrices, summarizeCosts } from "./harness/cost";
import { describeMode, resolveEvalMode } from "./harness/mode";
import { type CaptureResult, runGoldenSet } from "./harness/pipeline";
import { type CheckRecord, collectChecks, passRates, publishReport } from "./harness/report";
import { INJECTION_CHECKED_STAGES, PASS_RATE, checkStage } from "./harness/rubrics";

/**
 * Stage-level evals over the golden capture set.
 *
 * Hard checks (schema, no-injection) fail in every mode. Soft checks are
 * compared exactly against `evals/baselines/offline-rubrics.json` when
 * offline, and must hold for ≥ PASS_RATE of the set when online. Cost is
 * summarized and compared against `cost-baseline.json`; drift is a warning.
 */

const set = loadGoldenSet();
const mode = resolveEvalMode();
const captures = mode.only ? set.captures.filter((c) => c.id.startsWith(mode.only!)) : set.captures;

const startedAt = new Date().toISOString();
const results = new Map<string, CaptureResult>();
let checks: CheckRecord[] = [];
let costWarnings: CostWarning[] = [];
const recordedRubrics = readRubricBaseline();
const nextRubrics: RubricBaseline = {};

beforeAll(async () => {
  console.log(`evals: ${captures.length} captures, ${describeMode(mode)}`);
  const list = await runGoldenSet(set, mode);
  for (const r of list) results.set(r.capture.id, r);
  checks = collectChecks(list, (r, stage) => checkStage(r.capture, r.stages[stage]));
});

afterAll(() => {
  const list = [...results.values()];
  if (!list.length) return;
  const cost = summarizeCosts(list, mode.offline);
  const baseline = readCostBaseline();
  costWarnings = compareCosts(cost, baseline);

  if (mode.update) {
    if (mode.offline && !mode.only) writeRubricBaseline(nextRubrics);
    writeCostBaseline({
      prices: registryPrices(),
      estimated: mode.offline ? cost : baseline.estimated,
      measured: mode.offline ? baseline.measured : cost,
    });
    console.log("evals: baselines updated (EVAL_UPDATE_BASELINES=1)");
  }

  publishReport({ mode, results: list, checks, cost, costWarnings, startedAt });
});

function checksFor(captureId: string, stage: SiftStage): CheckRecord[] {
  return checks.filter((c) => c.captureId === captureId && c.stage === stage);
}

describe.each(captures.map((c) => [c.id, c] as const))("%s", (_id, capture) => {
  describe.each(SIFT_STAGES)("%s", (stage) => {
    it("conforms to the stage schema", () => {
      const schema = checksFor(capture.id, stage).find((c) => c.check === "schema");
      expect(schema, "schema check ran").toBeDefined();
      expect(schema!.pass, `${capture.id}/${stage}: ${schema!.detail}`).toBe(true);
    });

    if (capture.injection && INJECTION_CHECKED_STAGES.includes(stage)) {
      it("ignores instructions embedded in the task text", () => {
        const run = results.get(capture.id)!.stages[stage];
        if (run.output === null) return; // the schema test reports the failure
        const check = checksFor(capture.id, stage).find((c) => c.check === "no-injection");
        expect(check, "no-injection check ran").toBeDefined();
        expect(check!.pass, `${capture.id}/${stage}: ${check!.detail}`).toBe(true);
      });
    }

    if (mode.offline) {
      it("soft checks match the recorded offline baseline", () => {
        const current = Object.fromEntries(
          checksFor(capture.id, stage)
            .filter((c) => !c.hard)
            .map((c) => [c.check, c.pass]),
        );
        nextRubrics[capture.id] = { ...nextRubrics[capture.id], [stage]: current };
        if (mode.update) return;

        const recorded = recordedRubrics[capture.id]?.[stage];
        expect(
          recorded,
          `no offline baseline for ${capture.id}/${stage}. Run \`SIFTY_AI_OFFLINE=1 pnpm eval:update\` and commit evals/baselines/offline-rubrics.json.`,
        ).toBeDefined();

        const diffs: string[] = [];
        for (const key of new Set([...Object.keys(recorded!), ...Object.keys(current)])) {
          const was = recorded![key];
          const is = current[key];
          if (was === is) continue;
          const detail = checksFor(capture.id, stage).find((c) => c.check === key)?.detail ?? "";
          const label =
            was === undefined
              ? "new check"
              : is === undefined
                ? "check no longer runs"
                : is
                  ? "now passes (improvement — re-record the baseline)"
                  : "REGRESSION";
          diffs.push(`${key}: ${label}${detail ? ` — ${detail}` : ""}`);
        }
        expect(
          diffs,
          `${capture.id}/${stage} differs from evals/baselines/offline-rubrics.json:\n  ${diffs.join("\n  ")}\nIf the change is intended, run \`SIFTY_AI_OFFLINE=1 pnpm eval:update\`.`,
        ).toEqual([]);
      });
    }
  });
});

if (!mode.offline) {
  describe.each(SIFT_STAGES)("%s soft checks across the set", (stage) => {
    it(`hold for at least ${Math.round(PASS_RATE * 100)}% of captures`, () => {
      const rates = passRates(checks.filter((c) => c.stage === stage && !c.hard));
      const failing: string[] = [];
      for (const [key, rate] of rates) {
        if (rate.pass / rate.total >= PASS_RATE) continue;
        failing.push(
          `${key}: ${rate.pass}/${rate.total}\n    ${rate.fails.map((f) => `${f.captureId}: ${f.detail}`).join("\n    ")}`,
        );
      }
      expect(failing, `soft checks below ${PASS_RATE * 100}%:\n  ${failing.join("\n  ")}`).toEqual(
        [],
      );
    });
  });
}

describe("cost", () => {
  it("is priced from the model registry for every stage", () => {
    const cost = summarizeCosts([...results.values()], mode.offline);
    for (const stage of SIFT_STAGES) {
      const c = cost.stages[stage];
      expect(Object.hasOwn(MODELS, c.model), `${stage} model ${c.model} is in MODELS`).toBe(true);
      expect(c.costCents).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(c.costCents)).toBe(true);
    }
    expect(cost.pipelineCostCents).toBeGreaterThanOrEqual(0);
  });
});
