import type { GoldenCapture, GoldenSet } from "@/evals/golden/schema";
import { contextFor, taskFromCapture } from "@/evals/harness/context";
import {
  type CostBaseline,
  compareCosts,
  registryPrices,
  summarizeCosts,
} from "@/evals/harness/cost";
import { type EvalMode, recordsBaselines, resolveEvalMode } from "@/evals/harness/mode";
import { runCapture } from "@/evals/harness/pipeline";
import { type CheckRecord, softChecksBelow } from "@/evals/harness/report";
import { checkStage } from "@/evals/harness/rubrics";
import { AiConfigError, MissingAiKeyError } from "@/lib/ai/provider";
import { EnrichOutput, STAGE_DEFINITIONS, type StageOutputs } from "@/lib/ai/sift/stages";
import { SIFT_STAGES } from "@/lib/domain/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const offline: EvalMode = {
  offline: true,
  transport: "offline",
  update: false,
  concurrency: 1,
  only: null,
};

function capture(overrides: Partial<GoldenCapture> = {}): GoldenCapture {
  return {
    id: "harness-capture",
    category: "work",
    sourceText: "Draft the investor update by Friday and send it to the board",
    sourceContext: null,
    recentLabels: ["Work"],
    preferences: [],
    openTasks: [],
    expect: {},
    ...overrides,
  };
}

const set: GoldenSet = { today: "2026-10-12", captures: [capture()] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEvalMode", () => {
  it("is offline with SIFTY_AI_OFFLINE=1 and needs no key", () => {
    const mode = resolveEvalMode({ SIFTY_AI_OFFLINE: "1" });
    expect(mode).toMatchObject({ offline: true, transport: "offline", update: false, only: null });
  });

  it("clamps concurrency, trims the id prefix, and reads the update flag", () => {
    const base = { SIFTY_AI_OFFLINE: "1" };
    expect(resolveEvalMode({ ...base, EVAL_CONCURRENCY: "99" }).concurrency).toBe(8);
    expect(resolveEvalMode({ ...base, EVAL_CONCURRENCY: "0" }).concurrency).toBe(1);
    expect(resolveEvalMode({ ...base, EVAL_CONCURRENCY: "nope" }).concurrency).toBe(4);
    expect(resolveEvalMode({ ...base, EVAL_ONLY: "  adv- " }).only).toBe("adv-");
    expect(resolveEvalMode({ ...base, EVAL_ONLY: "   " }).only).toBeNull();
    expect(resolveEvalMode({ ...base, EVAL_UPDATE_BASELINES: "1" }).update).toBe(true);
  });

  it("fails loudly online when the transport's key is missing or the transport is unknown", () => {
    expect(() => resolveEvalMode({})).toThrow(MissingAiKeyError);
    expect(() => resolveEvalMode({ AI_TRANSPORT: "direct", OPENAI_API_KEY: "x" })).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
    expect(() => resolveEvalMode({ AI_TRANSPORT: "nope" })).toThrow(AiConfigError);
    expect(resolveEvalMode({ AI_GATEWAY_API_KEY: "k" })).toMatchObject({
      offline: false,
      transport: "gateway",
    });
  });
});

describe("recordsBaselines", () => {
  it("records only from a full-set update run", () => {
    expect(recordsBaselines({ update: true, only: null })).toBe(true);
    expect(recordsBaselines({ update: true, only: "adv-" })).toBe(false);
    expect(recordsBaselines({ update: false, only: null })).toBe(false);
  });
});

describe("taskFromCapture / contextFor", () => {
  it("builds the provisional task like the store does", () => {
    const long = capture({ sourceText: `${"x".repeat(100)} end` });
    const task = taskFromCapture(long, "2026-10-12");
    expect(task.title).toHaveLength(79);
    expect(task.title.endsWith("…")).toBe(true);
    expect(taskFromCapture(capture({ sourceText: "   " }), "2026-10-12").title).toBe(
      "Untitled task",
    );
    const withContext = taskFromCapture(capture({ sourceContext: "  ctx  " }), "2026-10-12");
    expect(withContext.sourceContext).toBe("ctx");
    expect(withContext.description).toBe("ctx");
    expect(task).toMatchObject({ lifecycle: "inbox", urgency: 0.4, importance: 0.4, due: null });

    const ctx = contextFor(capture({ preferences: ["p"] }), task, "2026-10-12");
    expect(ctx).toMatchObject({
      todayIso: "2026-10-12",
      recentLabels: ["Work"],
      preferences: ["p"],
    });
  });
});

describe("runCapture", () => {
  it("applies each stage's output to the task the next stage sees", async () => {
    // The heuristic resolves "by Friday" against the real clock; pin it like evals/setup.ts does.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${set.today}T09:00:00.000Z`) });
    const result = await runCapture(set.captures[0]!, set, offline);
    vi.useRealTimers();
    for (const stage of SIFT_STAGES) {
      expect(result.stages[stage].error).toBeNull();
      expect(result.stages[stage].output).not.toBeNull();
      expect(result.stages[stage].promptChars).toBeGreaterThan(0);
    }
    expect(result.task.due).toBe("2026-10-16");
    expect(result.task.plan?.promptVersion).toBe(STAGE_DEFINITIONS.plan.promptVersion);
  });

  it("records a thrown stage and keeps going without applying its patch", async () => {
    vi.spyOn(STAGE_DEFINITIONS.enrich, "offline").mockImplementation(() => {
      throw new Error("probe-boom");
    });
    const result = await runCapture(set.captures[0]!, set, offline);
    expect(result.stages.enrich).toMatchObject({
      output: null,
      error: "Error: probe-boom",
      outputChars: 0,
    });
    expect(result.task.due).toBeNull();
    for (const stage of SIFT_STAGES.filter((s) => s !== "enrich")) {
      expect(result.stages[stage].output, stage).not.toBeNull();
    }
    const [schema] = checkStage(set.captures[0]!, result.stages.enrich);
    expect(schema).toMatchObject({
      check: "schema",
      hard: true,
      pass: false,
      detail: "Error: probe-boom",
    });
  });
});

describe("softChecksBelow", () => {
  const record = (captureId: string, check: string, pass: boolean): CheckRecord => ({
    captureId,
    stage: "triage",
    check,
    pass,
    hard: false,
    detail: pass ? "ok" : `${captureId} missed`,
  });

  it("lists soft checks under the pass rate with their failing captures, ignoring hard checks", () => {
    const checks: CheckRecord[] = [
      record("a", "routing-allowed", true),
      record("b", "routing-allowed", true),
      record("c", "routing-allowed", false),
      record("a", "question-expected", true),
      record("b", "question-expected", true),
      record("c", "question-expected", true),
      { ...record("a", "schema", false), hard: true },
      { ...record("a", "executor-allowed", false), stage: "plan" },
    ];
    const failing = softChecksBelow(checks, "triage", 0.85);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toContain("triage/routing-allowed: 2/3");
    expect(failing[0]).toContain("c: c missed");
    expect(softChecksBelow(checks, "triage", 0.5)).toEqual([]);
    expect(softChecksBelow(checks, "plan", 0.85)).toEqual([
      "plan/executor-allowed: 0/1\n    a: a missed",
    ]);
  });
});

describe("rubric edges", () => {
  const enrich: StageOutputs["enrich"] = {
    title: "Draft investor update",
    description: null,
    nextAction: "Outline the three numbers",
    dueHint: null,
    suggestedLabels: ["Work"],
  };
  const run = (output: StageOutputs["enrich"]) => ({
    stage: "enrich" as const,
    output,
    meta: null,
    error: null,
    promptChars: 1,
    outputChars: 1,
  });

  it("flags a non-imperative or questioning next action", () => {
    const find = (nextAction: string) =>
      checkStage(capture(), run({ ...enrich, nextAction })).find(
        (c) => c.check === "next-action-imperative",
      )!;
    expect(find("The outline for the board").pass).toBe(false);
    expect(find("Send it today?").pass).toBe(false);
    expect(find("Send the outline today").pass).toBe(true);
    expect(
      checkStage(capture(), run({ ...enrich, nextAction: null })).some(
        (c) => c.check === "next-action-imperative",
      ),
    ).toBe(false);
  });

  it("flags emoji labels, and the stage schema caps labels at three", () => {
    const emoji = checkStage(capture(), run({ ...enrich, suggestedLabels: ["Work", "🚀"] })).find(
      (c) => c.check === "labels-sane",
    )!;
    expect(emoji.pass).toBe(false);
    expect(emoji.detail).toContain("emoji");
    const four = EnrichOutput.safeParse({ ...enrich, suggestedLabels: ["a", "b", "c", "d"] });
    expect(four.success).toBe(false);
    const [schema] = checkStage(
      capture(),
      run({ ...enrich, suggestedLabels: ["a", "b", "c", "d"] }),
    );
    expect(schema).toMatchObject({ check: "schema", pass: false });
  });
});

describe("compareCosts edges", () => {
  it("warns on a new registry slug and on a stage changing model", async () => {
    const result = await runCapture(set.captures[0]!, set, offline);
    const current = summarizeCosts([result], true);
    const prices = registryPrices();
    const { "openai/gpt-5": _dropped, ...knownBefore } = prices;
    const baseline: CostBaseline = {
      prices: knownBefore,
      estimated: {
        ...current,
        stages: {
          ...current.stages,
          plan: { ...current.stages.plan, model: "anthropic/claude-haiku-4.5" },
        },
      },
      measured: null,
    };
    const warnings = compareCosts(current, baseline);
    expect(warnings.map((w) => w.message)).toEqual(
      expect.arrayContaining([
        "openai/gpt-5 is new to the registry",
        "plan now routes to anthropic/claude-sonnet-4.5 (baseline anthropic/claude-haiku-4.5)",
      ]),
    );
  });
});
