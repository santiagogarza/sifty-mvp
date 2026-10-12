import type { SiftInput } from "@/lib/ai/sift/execute-stage";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { decisionHookToken } from "@/lib/decisions/hook";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";
import { getTestRepos } from "../setup";

/**
 * The `siftTask` workflow body end to end against the in-memory repos.
 * Without the Workflow compiler `"use workflow"` / `"use step"` are
 * no-ops, so this is exactly the orchestration the runtime replays, with
 * the runtime primitives (`createHook`, `sleep`, metadata) scripted: the
 * test plays the human who answers, dismisses, or never shows up.
 */

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

interface ScriptedHook {
  token: string;
  resolve: (payload: unknown) => void;
  disposed: boolean;
}
const hooks: ScriptedHook[] = [];
let sleepResolve: (() => void) | null = null;

vi.mock("workflow", () => {
  class FatalError extends Error {}
  return {
    FatalError,
    getWorkflowMetadata: () => ({ workflowRunId: "wrun_test" }),
    sleep: () =>
      new Promise<void>((resolve) => {
        sleepResolve = resolve;
      }),
    createHook: (opts: { token: string }) => {
      let resolve!: (payload: unknown) => void;
      const payload = new Promise<unknown>((r) => {
        resolve = r;
      });
      const scripted: ScriptedHook = { token: opts.token, resolve, disposed: false };
      hooks.push(scripted);
      // A real Hook is a thenable (`await hook` yields the payload); the
      // scripted one is the payload promise itself with the Hook surface
      // attached, so the workflow body awaits it exactly as in production.
      return Object.assign(payload, {
        token: opts.token,
        getConflict: async () => null,
        dispose: () => {
          scripted.disposed = true;
        },
      });
    },
  };
});

async function seed(opts: { offline: boolean; sourceText?: string }) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: "wf@example.com",
    displayName: "W",
    isCreator: false,
  });
  const task = await repos.tasks.create(user.id, {
    sourceText: opts.sourceText ?? "Taxes",
    sourceContext: null,
  });
  const accounting = await repos.aiRuns.insert({
    userId: user.id,
    taskId: task.id,
    promptVersion: "sift.v1",
    stage: SIFT_ACCOUNTING_STAGE,
    siftId: "sift_wf",
    model: "sifty.workflow",
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline: opts.offline,
    error: null,
  });
  await repos.tasks.update(user.id, task.id, { siftId: "sift_wf", aiStatus: "pending" });
  const input: SiftInput = {
    userId: user.id,
    taskId: task.id,
    siftId: "sift_wf",
    accountingRunId: accounting.id,
    modelPreference: null,
    offline: opts.offline,
  };
  return { repos, user, task, input };
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, label: string): Promise<T> {
  for (let i = 0; i < 200; i += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const decisionHook = () => hooks.find((h) => h.token.startsWith("decision:"));
const slotHooks = () => hooks.filter((h) => h.token.startsWith("sift:"));

beforeEach(async () => {
  hooks.length = 0;
  sleepResolve = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  const { resolveProvider } = await import("@/lib/ai/provider");
  vi.mocked(resolveProvider).mockReset();
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("siftTask with a clarifying question (offline stages)", () => {
  it("finishes the sift, opens the decision, releases its slot, and waits", async () => {
    const { siftTask } = await import("@/lib/workflows/sift-task");
    const { repos, user, task, input } = await seed({ offline: true });

    const run = siftTask(input);
    const decision = await until(
      () => repos.decisions.listOpenForTask(user.id, task.id),
      (list) => list.length === 1,
      "the decision",
    ).then((list) => list[0]!);

    // The decision exists before the task reads `ready`, and the task is
    // usable while the question is open.
    const ready = await until(
      () => repos.tasks.get(user.id, task.id),
      (t) => t?.aiStatus === "ready",
      "the task to be ready",
    );
    expect(ready?.aiAttempts).toBe(1);
    expect(ready?.clarifyingQuestion).toBe("What outcome would mark this as done?");
    expect(decision).toMatchObject({
      kind: "clarifying_question",
      status: "open",
      taskId: task.id,
      resumeToken: decisionHookToken(decision.id),
      payload: {
        question: "What outcome would mark this as done?",
        options: ["A decision", "Something sent", "Something built"],
        siftId: "sift_wf",
      },
    });
    expect(decision.expiresAt).not.toBeNull();

    // The hook was registered before the decision row existed, under the
    // token the row points at, and the user's slot is free while waiting.
    expect(decisionHook()?.token).toBe(decision.resumeToken);
    expect(slotHooks()).toHaveLength(1);
    expect(slotHooks()[0]!.disposed).toBe(true);

    // Nothing else happens until the human does.
    await new Promise((r) => setTimeout(r, 20));
    expect((await repos.aiRuns.list(user.id)).filter((r) => r.stage !== "sift")).toHaveLength(5);

    decisionHook()!.resolve({ status: "dismissed" });
    await expect(run).resolves.toEqual({ outcome: "completed", decision: "dismissed" });
    // The route marks assumptions; the run itself leaves the task as sifted.
    expect((await repos.tasks.get(user.id, task.id))?.aiAttempts).toBe(1);
  });

  it("an answer re-acquires a slot, folds the answer in, and re-runs every stage in the same sift", async () => {
    const { siftTask } = await import("@/lib/workflows/sift-task");
    const { repos, user, task, input } = await seed({ offline: true });

    const run = siftTask(input);
    await until(
      () => repos.decisions.countOpen(user.id),
      (n) => n === 1,
      "the decision",
    );
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id);
    // What the answer route does before waking the run.
    await repos.decisions.resolve(user.id, decision!.id, {
      status: "answered",
      answer: { text: "File the federal return by Friday", option: null, via: "app" },
    });
    decisionHook()!.resolve({
      status: "answered",
      answer: { text: "File the federal return by Friday", option: null, via: "app" },
    });

    await expect(run).resolves.toEqual({ outcome: "completed", decision: "answered" });

    const done = (await repos.tasks.get(user.id, task.id))!;
    expect(done.aiStatus).toBe("ready");
    expect(done.siftId).toBe("sift_wf");
    expect(done.aiAttempts).toBe(2);
    expect(done.sourceContext).toBe("Answer: File the federal return by Friday");
    expect(done.clarifyingQuestion).toBeNull();
    expect(done.siftedWithAssumptions).toBe(false);
    // The answer reached every stage: "by Friday" became a due date and the
    // heuristic's confidence rose past the asking threshold.
    expect(done.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.confidence).toBeGreaterThanOrEqual(0.7);

    // Two passes, ten stage rows, one sift; the slot was taken twice.
    const rows = await repos.aiRuns.list(user.id);
    expect(rows.filter((r) => r.stage !== "sift")).toHaveLength(10);
    expect(new Set(rows.map((r) => r.siftId))).toEqual(new Set(["sift_wf"]));
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0); // offline sifts are free
    expect(slotHooks()).toHaveLength(2);
    expect(hooks.filter((h) => h.token.startsWith("decision:"))).toHaveLength(1);
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
  });

  it("the deadline expires an unanswered question and ends the run", async () => {
    const { siftTask } = await import("@/lib/workflows/sift-task");
    const { repos, user, task, input } = await seed({ offline: true });

    const run = siftTask(input);
    await until(
      () => repos.decisions.countOpen(user.id),
      (n) => n === 1,
      "the decision",
    );
    await until(
      async () => sleepResolve !== null,
      (v) => v,
      "the deadline timer",
    );
    sleepResolve!();

    await expect(run).resolves.toEqual({ outcome: "completed", decision: "expired" });
    const [decision] = await repos.decisions.listOpen(user.id);
    expect(decision).toBeUndefined();
    expect((await repos.tasks.get(user.id, task.id))?.aiAttempts).toBe(1);
  });

  it("a confident capture asks nothing and completes in one pass", async () => {
    const { siftTask } = await import("@/lib/workflows/sift-task");
    const { repos, user, input } = await seed({
      offline: true,
      sourceText: "Draft the investor update by Friday and send it to the board",
    });
    await expect(siftTask(input)).resolves.toEqual({ outcome: "completed" });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    expect(decisionHook()).toBeUndefined();
    expect(slotHooks()).toHaveLength(1);
    expect(slotHooks()[0]!.disposed).toBe(false);
  });
});

describe("siftTask with the mock model", () => {
  it("asks once: the second pass sees the answer in the prompt and drops a repeated question", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    const { resolveProvider } = await import("@/lib/ai/provider");
    const { generateObject } = await import("ai");
    vi.mocked(resolveProvider).mockImplementation((stage) => mockResolvedProvider(stage));

    const prompts: Array<{ schemaName: string; prompt: string }> = [];
    let triageCalls = 0;
    vi.mocked(generateObject).mockImplementation((async (args: {
      schemaName: string;
      prompt: string;
    }) => {
      prompts.push({ schemaName: args.schemaName, prompt: args.prompt });
      const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
      switch (args.schemaName) {
        case "EnrichOutput":
          return {
            object: {
              title: "Sort out taxes",
              description: null,
              nextAction: "Find last year's return",
              dueHint: null,
              suggestedLabels: ["Finance"],
            },
            usage,
          };
        case "PrioritizeOutput":
          return {
            object: { urgency: 0.5, importance: 0.7, effort: "medium", rationale: "Money." },
            usage,
          };
        case "TriageStageOutput":
          triageCalls += 1;
          return {
            object: {
              routing: "inbox",
              delegationCandidate: "self",
              confidence: triageCalls === 1 ? 0.4 : 0.5,
              // The model keeps asking; the second pass must not re-open.
              clarifyingQuestion:
                triageCalls === 1 ? "Personal or company taxes?" : "Still unsure?",
              clarifyingOptions: triageCalls === 1 ? ["Personal", "Company"] : [],
            },
            usage,
          };
        case "SubtasksOutput":
          return { object: { subtasks: [] }, usage };
        case "PlanOutput":
          return {
            object: {
              executor: "self",
              approach: null,
              connectors: [],
              readyForAi: false,
              blockers: null,
            },
            usage,
          };
        default:
          throw new Error(`unexpected schema ${args.schemaName}`);
      }
    }) as unknown as typeof generateObject);

    const { siftTask } = await import("@/lib/workflows/sift-task");
    const { repos, user, task, input } = await seed({ offline: false });
    const run = siftTask(input);
    await until(
      () => repos.decisions.countOpen(user.id),
      (n) => n === 1,
      "the decision",
    );
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id);
    expect(decision!.payload).toMatchObject({
      question: "Personal or company taxes?",
      options: ["Personal", "Company"],
      confidence: 0.4,
    });
    expect((await repos.tasks.get(user.id, task.id))?.title).toBe("Sort out taxes");

    await repos.decisions.resolve(user.id, decision!.id, {
      status: "answered",
      answer: { text: null, option: "Company", via: "link" },
    });
    decisionHook()!.resolve({
      status: "answered",
      answer: { text: null, option: "Company", via: "link" },
    });
    await expect(run).resolves.toEqual({ outcome: "completed", decision: "answered" });

    expect(prompts).toHaveLength(10);
    const triagePrompts = prompts.filter((p) => p.schemaName === "TriageStageOutput");
    expect(triagePrompts[0]!.prompt).not.toContain("Answer:");
    expect(triagePrompts[1]!.prompt).toContain("Answer: Company");
    // Every second-pass stage saw the answer.
    expect(prompts.slice(5).every((p) => p.prompt.includes("Answer: Company"))).toBe(true);

    const done = (await repos.tasks.get(user.id, task.id))!;
    expect(done.clarifyingQuestion).toBeNull();
    expect(done.confidence).toBe(0.5);
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    const rows = await repos.aiRuns.list(user.id);
    expect(rows.filter((r) => r.stage === "triage")).toHaveLength(2);
    expect(
      rows.filter((r) => r.stage === "triage").every((r) => r.promptVersion === "triage.v3"),
    ).toBe(true);
    // One sift on the cap, however many passes.
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(1);
  });
});
