import { routeLifecycle, stagePatch } from "@/lib/ai/sift/apply";
import { runStage } from "@/lib/ai/sift/run-stage";
import {
  STAGE_DEFINITIONS,
  type SiftContext,
  offlineClarifyingOptions,
} from "@/lib/ai/sift/stages";
import { SIFT_STAGES, type Task } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    sourceText: "Draft the investor update by Friday and send it to the board",
    sourceContext: null,
    title: "Draft the investor update by Friday and send it to the board",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "running",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
    assigneeName: null,
    confidence: 0,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: "sift_1",
    siftStage: null,
    plan: null,
    siftedWithAssumptions: false,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<SiftContext> = {}): SiftContext {
  return {
    task: task(),
    todayIso: "2026-10-12",
    recentLabels: ["Work"],
    preferences: [],
    openTasks: [],
    ...overrides,
  };
}

beforeEach(async () => {
  const { resolveProvider } = await import("@/lib/ai/provider");
  vi.mocked(resolveProvider).mockReset();
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("offline stages", () => {
  it("every stage has a deterministic schema-valid offline answer", async () => {
    for (const stage of SIFT_STAGES) {
      const a = await runStage(stage, ctx(), { offline: true });
      const b = await runStage(stage, ctx(), { offline: true });
      expect(a.output).toEqual(b.output);
      expect(a.meta.transport).toBe("offline");
      expect(a.meta.stage).toBe(stage);
      expect(a.meta.promptVersion).toBe(STAGE_DEFINITIONS[stage].promptVersion);
      expect(a.meta.costCents).toBeNull();
    }
    const { generateObject } = await import("ai");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("slices the single-shot heuristic: enrich/prioritize/subtasks agree with it", async () => {
    const enrich = await runStage("enrich", ctx(), { offline: true });
    expect(enrich.output.title).toBe(
      "Draft the investor update by Friday and send it to the board",
    );
    expect(enrich.output.dueHint).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enrich.output.suggestedLabels).toContain("Work");

    const prio = await runStage("prioritize", ctx(), { offline: true });
    expect(prio.output.importance).toBeGreaterThan(0.5); // "investor" + "board"
    expect(prio.output.rationale).toMatch(/Heuristic triage/);

    const plan = await runStage("plan", ctx(), { offline: true });
    expect(plan.output.executor).toBe("ai_agent"); // "draft" is AI-suitable
    expect(plan.output.readyForAi).toBe(true);
  });

  it("routes blocked captures to waiting and aspirational ones to someday", async () => {
    const waiting = await runStage(
      "triage",
      ctx({ task: task({ sourceText: "Waiting for Ana to reply about the invoice" }) }),
      { offline: true },
    );
    expect(waiting.output.routing).toBe("waiting");
    const someday = await runStage(
      "triage",
      ctx({ task: task({ sourceText: "Someday learn to sail" }) }),
      { offline: true },
    );
    expect(someday.output.routing).toBe("someday");
    const inbox = await runStage("triage", ctx(), { offline: true });
    expect(inbox.output.routing).toBe("inbox");
  });

  it("offers tappable options for each canned question, none when confident, none once answered", async () => {
    const terse = await runStage("triage", ctx({ task: task({ sourceText: "Taxes" }) }), {
      offline: true,
    });
    expect(terse.output.clarifyingQuestion).toBe("What outcome would mark this as done?");
    expect(terse.output.clarifyingOptions).toEqual([
      "A decision",
      "Something sent",
      "Something built",
    ]);

    const asked = await runStage(
      "triage",
      ctx({ task: task({ sourceText: "Should we move the offsite to March?" }) }),
      { offline: true },
    );
    expect(asked.output.clarifyingQuestion).toMatch(/research note/);
    expect(asked.output.clarifyingOptions).toEqual(["Yes, a note", "No, it's a task"]);

    // The heuristic's third question (deadline) needs confidence < 0.55 with
    // three or more words and no question mark, which its scoring never
    // produces; its option list is pinned directly so the map stays complete.
    expect(offlineClarifyingOptions("Is there a deadline I should know about?")).toEqual([
      "This week",
      "This month",
      "No deadline",
    ]);
    expect(offlineClarifyingOptions("Something the model made up?")).toEqual([]);

    const confident = await runStage("triage", ctx(), { offline: true });
    expect(confident.output.clarifyingQuestion).toBeNull();
    expect(confident.output.clarifyingOptions).toEqual([]);

    // The second pass after an answer never re-asks.
    const answered = await runStage(
      "triage",
      ctx({ task: task({ sourceText: "Taxes", sourceContext: "Answer: Something sent" }) }),
      { offline: true },
    );
    expect(answered.output.clarifyingQuestion).toBeNull();
    expect(answered.output.clarifyingOptions).toEqual([]);
    expect(answered.output.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe("online stages", () => {
  it("resolves the stage's own model, validates against its schema, and prices usage", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "k");
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockImplementation((stage) => mockResolvedProvider(stage));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: { urgency: 0.7, importance: 0.9, effort: "medium", rationale: "Board deadline." },
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const result = await runStage("prioritize", ctx(), { offline: false, modelPreference: "fast" });
    expect(resolveProvider).toHaveBeenCalledWith("prioritize", { preference: "fast" });
    expect(result.output.importance).toBe(0.9);
    expect(result.meta.model).toBe("anthropic/claude-haiku-4.5");
    expect(result.meta.costCents).toBeCloseTo(100, 6); // 1M in @ $1/M
    expect(result.meta.promptVersion).toBe("prioritize.v1");

    const call = vi.mocked(generateObject).mock.calls[0]![0] as { prompt: string; system: string };
    expect(call.system).toContain("prioritize one task against the rest");
    expect(call.prompt).toContain("No other open tasks.");
  });

  it("prioritize sees the rest of the list", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "k");
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockImplementation((stage) => mockResolvedProvider(stage));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: { urgency: 0.3, importance: 0.3, effort: "quick", rationale: null },
      usage: { inputTokens: 1, outputTokens: 1 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);
    await runStage(
      "prioritize",
      ctx({
        openTasks: [
          {
            title: "File taxes",
            lifecycle: "active",
            due: "2026-10-13",
            urgency: 0.9,
            importance: 0.9,
            effort: "deep",
          },
        ],
      }),
      { offline: false },
    );
    const call = vi.mocked(generateObject).mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toContain("Other open tasks (1):");
    expect(call.prompt).toContain("[active] File taxes (due 2026-10-13)");
  });
});

describe("stagePatch", () => {
  it("writes only the stage's fields and honors editedFields", () => {
    const protectedTask = task({
      title: "My title",
      urgency: 0.1,
      editedFields: ["title", "urgency", "subtasks", "labelIds"],
      subtasks: [{ id: "st_mine", title: "Mine", done: false, order: 0 }],
    });
    const enrich = stagePatch(
      protectedTask,
      "enrich",
      {
        title: "AI title",
        description: "desc",
        nextAction: "Open the doc",
        dueHint: "2026-10-16",
        suggestedLabels: ["Work"],
      },
      { labelIds: ["label_work"] },
    );
    expect(enrich).toEqual({ description: "desc", nextAction: "Open the doc", due: "2026-10-16" });

    const prio = stagePatch(protectedTask, "prioritize", {
      urgency: 0.9,
      importance: 0.8,
      effort: "deep",
      rationale: "why",
    });
    expect(prio).toEqual({ importance: 0.8, effort: "deep", rationale: "why" });

    const sub = stagePatch(protectedTask, "subtasks", { subtasks: ["A", "B"] });
    expect(sub).toEqual({});

    const plan = stagePatch(protectedTask, "plan", {
      executor: "ai_agent",
      approach: "Draft it",
      connectors: ["gmail"],
      readyForAi: true,
      blockers: null,
    });
    expect(plan.plan).toMatchObject({ executor: "ai_agent", promptVersion: "plan.v1" });
  });

  it("unprotected enrich replaces labels and null descriptions keep the existing one", () => {
    const patch = stagePatch(
      task({ description: "kept" }),
      "enrich",
      { title: "T", description: null, nextAction: null, dueHint: null, suggestedLabels: ["X"] },
      { labelIds: ["label_x"] },
    );
    expect(patch).toEqual({ title: "T", nextAction: null, due: null, labelIds: ["label_x"] });
  });

  it("subtasks get fresh ids and order", () => {
    const patch = stagePatch(task(), "subtasks", { subtasks: ["First", "Second"] });
    expect(patch.subtasks?.map((s) => [s.title, s.order, s.done])).toEqual([
      ["First", 0, false],
      ["Second", 1, false],
    ]);
    expect(patch.subtasks?.[0]?.id).toMatch(/^st_/);
  });

  it("triage routing only moves untouched inbox tasks to waiting/someday", () => {
    expect(routeLifecycle({ lifecycle: "inbox" }, "waiting")).toBe("waiting");
    expect(routeLifecycle({ lifecycle: "inbox" }, "someday")).toBe("someday");
    expect(routeLifecycle({ lifecycle: "inbox" }, "active")).toBeNull();
    expect(routeLifecycle({ lifecycle: "inbox" }, "inbox")).toBeNull();
    expect(routeLifecycle({ lifecycle: "active" }, "waiting")).toBeNull();
    const patch = stagePatch(task({ editedFields: ["delegationCandidate"] }), "triage", {
      routing: "waiting",
      delegationCandidate: "ai",
      confidence: 0.5,
      clarifyingQuestion: "Which board?",
      clarifyingOptions: [],
    });
    expect(patch).toEqual({
      lifecycle: "waiting",
      confidence: 0.5,
      clarifyingQuestion: "Which board?",
    });
  });
});

describe("toneForName", () => {
  it("is deterministic and spreads across the palette", async () => {
    const { toneForName } = await import("@/lib/ai/ensure-labels");
    expect(toneForName("Work")).toBe(toneForName("work"));
    const tones = new Set(
      ["Work", "Home", "Errand", "Admin", "Writing", "Cursor", "Demo Prep", "Finance"].map(
        toneForName,
      ),
    );
    expect(tones.size).toBeGreaterThan(2);
  });
});
