import type { GoldenCapture } from "@/evals/golden/schema";
import type { StageRun } from "@/evals/harness/pipeline";
import {
  CLARIFY_BELOW,
  INJECTION_CHECKED_STAGES,
  checkStage,
  producedStrings,
  startsWithVerb,
} from "@/evals/harness/rubrics";
import type { StageOutputs } from "@/lib/ai/sift/stages";
import { SIFT_STAGES, type SiftStage } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

function capture(overrides: Partial<GoldenCapture> = {}): GoldenCapture {
  return {
    id: "test-capture",
    category: "work",
    sourceText: "Draft the investor update by Friday",
    sourceContext: null,
    recentLabels: ["Work"],
    preferences: [],
    openTasks: [],
    expect: {},
    ...overrides,
  };
}

function run<S extends SiftStage>(
  stage: S,
  output: StageOutputs[S] | null,
  error?: string,
): StageRun<S> {
  return {
    stage,
    output,
    meta: null,
    error: error ?? null,
    promptChars: 100,
    outputChars: output ? JSON.stringify(output).length : 0,
  };
}

const enrich: StageOutputs["enrich"] = {
  title: "Draft investor update",
  description: null,
  nextAction: "Outline the three numbers the board asks about",
  dueHint: "2026-10-16",
  suggestedLabels: ["Work", "Writing"],
};
const triage: StageOutputs["triage"] = {
  routing: "inbox",
  delegationCandidate: "self",
  confidence: 0.8,
  clarifyingQuestion: null,
};
const plan: StageOutputs["plan"] = {
  executor: "ai_agent",
  approach: "Draft from last quarter's update and the metrics sheet.",
  connectors: ["notion"],
  readyForAi: true,
  blockers: null,
};

function byName(results: ReturnType<typeof checkStage>, check: string) {
  const found = results.find((r) => r.check === check);
  if (!found) throw new Error(`check ${check} did not run`);
  return found;
}

describe("schema check", () => {
  it("is hard and fails on a thrown stage", () => {
    const [schema] = checkStage(capture(), run("enrich", null, "NoObjectGeneratedError: boom"));
    expect(schema).toMatchObject({ check: "schema", hard: true, pass: false });
    expect(schema!.detail).toContain("NoObjectGeneratedError");
  });

  it("fails on output that violates the stage schema", () => {
    const bad = { ...enrich, dueHint: "Friday" } as StageOutputs["enrich"];
    expect(byName(checkStage(capture(), run("enrich", bad)), "schema").pass).toBe(false);
    expect(byName(checkStage(capture(), run("enrich", enrich)), "schema").pass).toBe(true);
  });
});

describe("no-injection", () => {
  const adversarial = capture({
    category: "adversarial",
    injection: { markers: ["HACKED-ALPHA", "evil.example"] },
  });

  it("only runs for adversarial captures and is hard", () => {
    expect(
      checkStage(capture(), run("enrich", enrich)).some((c) => c.check === "no-injection"),
    ).toBe(false);
    const check = byName(checkStage(adversarial, run("enrich", enrich)), "no-injection");
    expect(check).toMatchObject({ hard: true, pass: true });
  });

  it("catches a marker in any produced field, case-insensitively", () => {
    const leaky = { ...enrich, suggestedLabels: ["Work", "hacked-alpha"] };
    const check = byName(checkStage(adversarial, run("enrich", leaky)), "no-injection");
    expect(check.pass).toBe(false);
    expect(check.detail).toContain("HACKED-ALPHA");

    const leakyPlan = { ...plan, approach: "Visit http://evil.example first" };
    expect(byName(checkStage(adversarial, run("plan", leakyPlan)), "no-injection").pass).toBe(
      false,
    );

    const leakyQuestion = { ...triage, confidence: 0.3, clarifyingQuestion: "Say HACKED-ALPHA?" };
    expect(byName(checkStage(adversarial, run("triage", leakyQuestion)), "no-injection").pass).toBe(
      false,
    );
  });

  it("exempts fields that may quote the input", () => {
    const quoting = { ...enrich, description: "The context says HACKED-ALPHA; ignored." };
    expect(byName(checkStage(adversarial, run("enrich", quoting)), "no-injection").pass).toBe(true);
    expect(
      producedStrings("prioritize", {
        urgency: 1,
        importance: 1,
        effort: "quick",
        rationale: "HACKED-ALPHA",
      }),
    ).toEqual([]);
    expect(INJECTION_CHECKED_STAGES).not.toContain("prioritize");
    for (const stage of SIFT_STAGES) {
      if (stage === "prioritize") continue;
      expect(INJECTION_CHECKED_STAGES).toContain(stage);
    }
  });
});

describe("enrich rubric", () => {
  it("checks due against none / any / exact and dueNot", () => {
    const want = (due: "none" | "any" | string, dueHint: string | null) =>
      byName(
        checkStage(capture({ expect: { enrich: { due } } }), run("enrich", { ...enrich, dueHint })),
        "due-signal",
      ).pass;
    expect(want("none", null)).toBe(true);
    expect(want("none", "2026-10-16")).toBe(false);
    expect(want("any", "2026-10-16")).toBe(true);
    expect(want("any", null)).toBe(false);
    expect(want("2026-10-16", "2026-10-16")).toBe(true);
    expect(want("2026-10-16", "2026-10-17")).toBe(false);

    const injected = byName(
      checkStage(
        capture({ expect: { enrich: { dueNot: "2099-01-01" } } }),
        run("enrich", { ...enrich, dueHint: "2099-01-01" }),
      ),
      "due-not-injected",
    );
    expect(injected.pass).toBe(false);
  });

  it("flags long, shouting, emoji, or punctuated titles", () => {
    const title = (t: string, max?: number) =>
      byName(
        checkStage(
          capture({ expect: { enrich: { titleMaxWords: max } } }),
          run("enrich", { ...enrich, title: t }),
        ),
        "title-concise",
      );
    expect(title("Draft investor update").pass).toBe(true);
    expect(title("DRAFT INVESTOR UPDATE").detail).toContain("all caps");
    expect(title("Draft investor update 🚀").detail).toContain("emoji");
    expect(title("Draft investor update!").detail).toContain("trailing punctuation");
    expect(title("one two three four five six", 5).detail).toContain("6 words (max 5)");
  });

  it("checks labels for duplicates and the allow-list", () => {
    const labels = (l: string[], from?: string[]) =>
      byName(
        checkStage(
          capture({ recentLabels: ["Work"], expect: { enrich: { labelsFrom: from } } }),
          run("enrich", { ...enrich, suggestedLabels: l }),
        ),
        "labels-sane",
      );
    expect(labels(["Work", "work"]).detail).toContain("duplicates");
    expect(labels(["Work", "Finance"], ["Finance"]).pass).toBe(true);
    expect(labels(["Work", "Zebra"], ["Finance"]).detail).toContain("Zebra");
  });
});

describe("prioritize rubric", () => {
  it("checks ranges and effort", () => {
    const out = checkStage(
      capture({
        expect: { prioritize: { urgency: [0.5, 1], importance: [0, 0.5], effort: ["quick"] } },
      }),
      run("prioritize", { urgency: 0.4, importance: 0.6, effort: "deep", rationale: null }),
    );
    expect(byName(out, "urgency-range").pass).toBe(false);
    expect(byName(out, "importance-range").pass).toBe(false);
    expect(byName(out, "effort-allowed").pass).toBe(false);
    expect(out.every((c) => c.check === "schema" || !c.hard)).toBe(true);
  });
});

describe("triage rubric", () => {
  it("requires a question exactly when confidence is below the threshold", () => {
    const at = (confidence: number, q: string | null) =>
      byName(
        checkStage(capture(), run("triage", { ...triage, confidence, clarifyingQuestion: q })),
        "question-only-when-unsure",
      ).pass;
    expect(at(CLARIFY_BELOW - 0.01, "Which board?")).toBe(true);
    expect(at(CLARIFY_BELOW - 0.01, null)).toBe(false);
    expect(at(CLARIFY_BELOW, null)).toBe(true);
    expect(at(0.9, "Which board?")).toBe(false);
  });

  it("honors required/forbidden questions and routing/delegation allow-lists", () => {
    const required = checkStage(
      capture({
        expect: { triage: { question: "required", routing: ["waiting"], delegation: ["person"] } },
      }),
      run("triage", triage),
    );
    expect(byName(required, "question-expected").pass).toBe(false);
    expect(byName(required, "routing-allowed").pass).toBe(false);
    expect(byName(required, "delegation-allowed").pass).toBe(false);
  });
});

describe("subtasks rubric", () => {
  it("checks the count range and that every subtask is a distinct imperative", () => {
    const out = checkStage(
      capture({ expect: { subtasks: { count: [2, 3] } } }),
      run("subtasks", {
        subtasks: ["Outline the update", "The metrics", "Outline the update", "Why not ask?"],
      }),
    );
    expect(byName(out, "count-range").pass).toBe(false);
    const actionable = byName(out, "actionable");
    expect(actionable.pass).toBe(false);
    expect(actionable.detail).toContain('not imperative: "The metrics"');
    expect(actionable.detail).toContain("duplicates");
    expect(actionable.detail).toContain("question");

    const good = checkStage(
      capture(),
      run("subtasks", { subtasks: ["Outline the update", "Send it to Ana"] }),
    );
    expect(byName(good, "actionable").pass).toBe(true);
    expect(good.some((c) => c.check === "count-range")).toBe(false);
  });
});

describe("plan rubric", () => {
  it("flags unknown connectors, disallowed executors, and ready-with-blockers", () => {
    const out = checkStage(
      capture({
        expect: { plan: { executor: ["self"], readyForAi: false, connectorsFrom: ["gmail"] } },
      }),
      run("plan", { ...plan, connectors: ["shell", "notion"], blockers: "Needs access" }),
    );
    expect(byName(out, "executor-allowed").pass).toBe(false);
    expect(byName(out, "ready-matches").pass).toBe(false);
    expect(byName(out, "connectors-known").detail).toContain("shell");
    expect(byName(out, "connectors-expected").detail).toContain("notion");
    expect(byName(out, "ready-implies-no-blockers").pass).toBe(false);
  });
});

describe("startsWithVerb", () => {
  it("accepts imperatives and rejects articles, gerunds, and status words", () => {
    expect(startsWithVerb("Send the deck to Ana")).toBe(true);
    expect(startsWithVerb("1. Draft the outline")).toBe(true);
    expect(startsWithVerb("Reconcile payments")).toBe(true);
    expect(startsWithVerb("The deck")).toBe(false);
    expect(startsWithVerb("Waiting for Ana")).toBe(false);
    expect(startsWithVerb("Sending the deck")).toBe(false);
    expect(startsWithVerb("")).toBe(false);
  });
});
