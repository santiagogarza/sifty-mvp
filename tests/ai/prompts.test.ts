import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "@/lib/ai/prompts";
import { describe, expect, it } from "vitest";

describe("TRIAGE_SYSTEM_PROMPT", () => {
  it("forbids invented dates and emoji", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toMatch(/Never invent dates/i);
    expect(TRIAGE_SYSTEM_PROMPT).toMatch(/No emoji/i);
  });
});

describe("buildTriageUserPrompt", () => {
  it("injects pinned memories under 'User preferences:'", () => {
    const out = buildTriageUserPrompt({
      sourceText: "draft launch announcement",
      sourceContext: null,
      todayIso: "2026-06-23",
      recentLabels: [],
      preferences: ["I avoid deep work after 4pm", "Prefer Cursor over VS Code"],
    });
    expect(out).toMatch(/Today is 2026-06-23/);
    expect(out).toContain("User preferences:");
    expect(out).toContain("I avoid deep work after 4pm");
    expect(out).toContain("Prefer Cursor over VS Code");
    expect(out).toContain("Task:\ndraft launch announcement");
  });

  it("omits preferences and labels sections when empty", () => {
    const out = buildTriageUserPrompt({
      sourceText: "Buy milk",
      sourceContext: null,
      todayIso: "2026-06-23",
      recentLabels: [],
      preferences: [],
    });
    expect(out).not.toContain("User preferences");
    expect(out).not.toContain("existing labels");
  });

  it("appends source context when provided", () => {
    const out = buildTriageUserPrompt({
      sourceText: "Refactor auth flow",
      sourceContext: "Sentry shows 5xx spikes after sign-in",
      todayIso: "2026-06-23",
      recentLabels: ["Work", "Cursor"],
      preferences: [],
    });
    expect(out).toContain("Additional context:\nSentry shows 5xx spikes after sign-in");
    expect(out).toContain("existing labels (prefer reusing): Work, Cursor");
  });

  it("is a stable contract (snapshot)", () => {
    const out = buildTriageUserPrompt({
      sourceText: "Draft email to investor by tomorrow",
      sourceContext: null,
      todayIso: "2026-06-23",
      recentLabels: ["Work", "Writing"],
      preferences: ["I avoid deep work after 4pm"],
    });
    expect(out).toMatchInlineSnapshot(`
      "Today is 2026-06-23.
      User's existing labels (prefer reusing): Work, Writing.
      User preferences:
      - I avoid deep work after 4pm
      Task:
      Draft email to investor by tomorrow"
    `);
  });
});
