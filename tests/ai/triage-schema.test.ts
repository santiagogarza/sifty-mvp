import { TriageOutput } from "@/lib/ai/triage-schema";
import { describe, expect, it } from "vitest";

const valid = {
  title: "Draft email to investor",
  description: null,
  nextAction: "Open Notion and write the first paragraph",
  urgency: 0.8,
  importance: 0.7,
  effort: "medium" as const,
  dueHint: "2026-07-01",
  delegationCandidate: "self" as const,
  suggestedLabels: ["Work"],
  subtasks: [],
  rationale: "Inferred from urgency phrase 'tomorrow'.",
  confidence: 0.78,
  clarifyingQuestion: null,
};

describe("TriageOutput schema", () => {
  it("accepts a fully valid object", () => {
    expect(TriageOutput.parse(valid)).toEqual(valid);
  });

  it("rejects out-of-range scalars", () => {
    expect(() => TriageOutput.parse({ ...valid, urgency: 1.5 })).toThrow();
    expect(() => TriageOutput.parse({ ...valid, importance: -0.1 })).toThrow();
    expect(() => TriageOutput.parse({ ...valid, confidence: 2 })).toThrow();
  });

  it("rejects malformed dueHint", () => {
    expect(() => TriageOutput.parse({ ...valid, dueHint: "next tuesday" })).toThrow();
    expect(() => TriageOutput.parse({ ...valid, dueHint: "2026-7-1" })).toThrow();
  });

  it("rejects unknown enum values for effort and delegation", () => {
    expect(() => TriageOutput.parse({ ...valid, effort: "huge" })).toThrow();
    expect(() => TriageOutput.parse({ ...valid, delegationCandidate: "outsource" })).toThrow();
  });

  it("rejects too many labels or subtasks", () => {
    expect(() => TriageOutput.parse({ ...valid, suggestedLabels: ["a", "b", "c", "d"] })).toThrow();
    expect(() =>
      TriageOutput.parse({ ...valid, subtasks: Array.from({ length: 6 }, () => "step") }),
    ).toThrow();
  });
});
