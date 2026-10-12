import {
  SIFT_FAILED_MESSAGE,
  type SiftInput,
  beginSift,
  buildSiftContext,
  executeSiftStage,
  failSift,
  finishSift,
} from "@/lib/ai/sift/execute-stage";
import { STAGE_DEFINITIONS } from "@/lib/ai/sift/stages";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { SIFT_STAGES } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
import { mockResolvedProvider } from "../helpers/ai";
import { getTestRepos } from "../setup";

/**
 * The step bodies against the in-memory repos. Without the Workflow
 * compiler `"use step"` is a no-op, so this is exactly the code each step
 * runs, minus retries and the queue.
 */

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

async function seed(opts: { offline?: boolean } = {}) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: "sift@example.com",
    displayName: "S",
    isCreator: false,
  });
  const task = await repos.tasks.create(user.id, {
    sourceText: "Draft the investor update by Friday and send it to the board",
    sourceContext: null,
  });
  const accounting = await repos.aiRuns.insert({
    userId: user.id,
    taskId: task.id,
    promptVersion: "sift.v1",
    stage: SIFT_ACCOUNTING_STAGE,
    siftId: "sift_1",
    model: "sifty.workflow",
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline: opts.offline ?? true,
    error: null,
  });
  await repos.tasks.update(user.id, task.id, { siftId: "sift_1", aiStatus: "pending" });
  const input: SiftInput = {
    userId: user.id,
    taskId: task.id,
    siftId: "sift_1",
    accountingRunId: accounting.id,
    modelPreference: null,
    offline: opts.offline ?? true,
  };
  return { repos, user, task, input };
}

beforeEach(async () => {
  const { resolveProvider } = await import("@/lib/ai/provider");
  vi.mocked(resolveProvider).mockReset();
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("sift steps (offline)", () => {
  it("runs the whole pipeline: each stage writes the task and one ai_runs row", async () => {
    const { repos, user, task, input } = await seed();

    expect(await beginSift(input)).toBe("applied");
    let current = await repos.tasks.get(user.id, task.id);
    expect(current?.aiStatus).toBe("running");
    expect(current?.siftStage).toBe("enrich");

    for (const stage of SIFT_STAGES) {
      expect(await executeSiftStage(input, stage, "wrun_1")).toBe("applied");
      current = await repos.tasks.get(user.id, task.id);
      expect(current?.siftStage).toBe(stage);
      expect(current?.aiStatus).toBe("running");
    }

    expect(await finishSift(input)).toBe("applied");
    const done = await repos.tasks.get(user.id, task.id);
    expect(done?.aiStatus).toBe("ready");
    expect(done?.siftStage).toBeNull();
    expect(done?.aiAttempts).toBe(1);
    expect(done?.title).toBe("Draft the investor update by Friday and send it to the board");
    expect(done?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done?.importance).toBeGreaterThan(0.5);
    expect(done?.priorityBucket).not.toBe("unset");
    expect(done?.rationale).toMatch(/Heuristic triage/);
    expect(done?.delegationCandidate).toBe("ai");
    expect(done?.plan).toMatchObject({ executor: "ai_agent", promptVersion: "plan.v1" });
    // Labels were ensured server-side and linked by canonical id.
    const labels = await repos.labels.list(user.id);
    expect(labels.map((l) => l.name)).toContain("Work");
    expect(done?.labelIds.length).toBeGreaterThan(0);
    expect(done?.labelIds).toContain(labels.find((l) => l.name === "Work")?.id);
    expect(done?.labelIds.every((id) => labels.some((l) => l.id === id))).toBe(true);

    const runs = await repos.aiRuns.list(user.id);
    const stageRows = runs.filter((r) => r.stage !== SIFT_ACCOUNTING_STAGE);
    expect(stageRows.map((r) => r.stage).sort()).toEqual([...SIFT_STAGES].sort());
    for (const row of stageRows) {
      expect(row.siftId).toBe("sift_1");
      expect(row.workflowRunId).toBe("wrun_1");
      expect(row.status).toBe("succeeded");
      expect(row.transport).toBe("offline");
      expect(row.promptVersion).toBe(
        STAGE_DEFINITIONS[row.stage as keyof typeof STAGE_DEFINITIONS].promptVersion,
      );
    }
    // Offline sifts never count against the daily cap; the five stage rows
    // are detail either way.
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
  });

  it("keeps a due the user set at capture and the date-free title that came with it", async () => {
    // What the capture chip produces: due protected, provisional title
    // without the date phrase, raw text untouched.
    const { repos, user, task, input } = await seed();
    await repos.tasks.update(
      user.id,
      task.id,
      { due: "2026-12-24", title: "Draft the investor update and send it to the board" },
      { editedFields: ["due"] },
    );
    await beginSift(input);
    await executeSiftStage(input, "enrich", "wrun_1");
    const enriched = await repos.tasks.get(user.id, task.id);
    expect(enriched?.due).toBe("2026-12-24");
    expect(enriched?.title).toBe("Draft the investor update and send it to the board");
    expect(enriched?.editedFields).toEqual(["due"]);
  });

  it("never overwrites a field the user edited between steps", async () => {
    const { repos, user, task, input } = await seed();
    await beginSift(input);
    await executeSiftStage(input, "enrich", "wrun_1");
    await repos.tasks.update(
      user.id,
      task.id,
      { title: "Board update", urgency: 0.2 },
      { editedFields: ["title", "urgency"] },
    );
    await executeSiftStage(input, "prioritize", "wrun_1");
    await executeSiftStage(input, "triage", "wrun_1");
    const t = await repos.tasks.get(user.id, task.id);
    expect(t?.title).toBe("Board update");
    expect(t?.urgency).toBe(0.2);
    // Unprotected fields of the same stage still landed.
    expect(t?.importance).toBeGreaterThan(0.5);
    expect(t?.effort).toBeDefined();
  });

  it("stops when a newer sift took the task over, and when the task is gone", async () => {
    const { repos, user, task, input } = await seed();
    await beginSift(input);
    await repos.tasks.update(user.id, task.id, { siftId: "sift_2" });
    expect(await executeSiftStage(input, "enrich", "wrun_1")).toBe("superseded");
    expect(await finishSift(input)).toBe("superseded");
    expect((await repos.tasks.get(user.id, task.id))?.title).toBe(task.title);

    await repos.tasks.delete(user.id, task.id);
    expect(await executeSiftStage(input, "enrich", "wrun_1")).toBe("missing");
    expect(await beginSift(input)).toBe("missing");
  });

  it("a re-sift landing between a step's read and its write is never overwritten", async () => {
    const { repos, user, task, input } = await seed();
    await beginSift(input);
    // Simulate the race: the model answers, then (before the write) a new
    // sift claims the task. The conditional update must refuse.
    const original = repos.tasks.get.bind(repos.tasks);
    let reads = 0;
    repos.tasks.get = async (uid, tid) => {
      const t = await original(uid, tid);
      reads += 1;
      // Second read inside executeSiftStage is the post-model re-read; let
      // it still see the old owner, then flip the owner underneath.
      if (reads === 2 && t) {
        await repos.tasks.update(uid, tid, { siftId: "sift_new", title: "New run" });
        return { ...t, siftId: "sift_1" };
      }
      return t;
    };
    expect(await executeSiftStage(input, "enrich", "wrun_1")).toBe("superseded");
    repos.tasks.get = original;
    const after = await repos.tasks.get(user.id, task.id);
    expect(after?.title).toBe("New run");
    expect(after?.siftId).toBe("sift_new");
    expect(await finishSift(input)).toBe("superseded");
    expect((await repos.tasks.get(user.id, task.id))?.aiStatus).not.toBe("ready");
  });

  it("failSift surfaces a stable message and stops counting the sift", async () => {
    const { repos, user, task, input } = await seed({ offline: false });
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(1);
    expect(await failSift(input, "provider exploded: key sk-123")).toBe("applied");
    const t = await repos.tasks.get(user.id, task.id);
    expect(t?.aiStatus).toBe("failed");
    expect(t?.aiError).toBe(SIFT_FAILED_MESSAGE);
    expect(t?.aiAttempts).toBe(1);
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
    const [accounting] = (await repos.aiRuns.list(user.id)).filter(
      (r) => r.stage === SIFT_ACCOUNTING_STAGE,
    );
    expect(accounting?.status).toBe("failed");
    expect(accounting?.error).toContain("provider exploded");
  });

  it("buildSiftContext excludes the task itself and closed tasks, bounded", async () => {
    const { repos, user, task } = await seed();
    await repos.tasks.create(user.id, { sourceText: "Other open", sourceContext: null });
    const done = await repos.tasks.create(user.id, { sourceText: "Done one", sourceContext: null });
    await repos.tasks.update(user.id, done.id, { lifecycle: "done" });
    await repos.memories.create(user.id, { text: "Mornings are for deep work", pinned: true });
    await repos.memories.create(user.id, { text: "not pinned", pinned: false });
    const ctx = await buildSiftContext(repos, user.id, task);
    expect(ctx.openTasks.map((o) => o.title)).toEqual(["Other open"]);
    expect(ctx.preferences).toEqual(["Mornings are for deep work"]);
    expect(ctx.todayIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("sift steps (online)", () => {
  it("records a failed row and rethrows transient model errors so Workflow retries", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "k");
    const { repos, user, input } = await seed({ offline: false });
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("enrich"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValue(new Error("model unavailable"));

    await beginSift(input);
    await expect(executeSiftStage(input, "enrich", "wrun_1")).rejects.toThrow("model unavailable");
    const failed = (await repos.aiRuns.list(user.id)).find((r) => r.stage === "enrich");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("model unavailable");
    expect(failed?.siftId).toBe("sift_1");
    expect(failed?.workflowRunId).toBe("wrun_1");
    expect(failed?.transport).toBe("unknown");
  });

  it("turns operator misconfiguration into a FatalError (no retries)", async () => {
    const { input } = await seed({ offline: false });
    const { MissingAiKeyError, resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new MissingAiKeyError("AI_TRANSPORT=gateway requires AI_GATEWAY_API_KEY.");
    });
    await beginSift(input);
    await expect(executeSiftStage(input, "enrich", "wrun_1")).rejects.toBeInstanceOf(FatalError);
  });

  it("applies the model's answer with cost attribution", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "k");
    const { repos, user, task, input } = await seed({ offline: false });
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockImplementation((stage) => mockResolvedProvider(stage));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        title: "Investor update",
        description: null,
        nextAction: "Open last quarter's update",
        dueHint: "2026-10-16",
        suggestedLabels: ["Work", "Board"],
      },
      usage: { inputTokens: 200_000, outputTokens: 80_000 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    await beginSift(input);
    expect(await executeSiftStage(input, "enrich", "wrun_9")).toBe("applied");
    const t = await repos.tasks.get(user.id, task.id);
    expect(t?.title).toBe("Investor update");
    expect(t?.due).toBe("2026-10-16");
    expect(t?.labelIds).toHaveLength(2);
    const row = (await repos.aiRuns.list(user.id)).find((r) => r.stage === "enrich");
    expect(row?.model).toBe("anthropic/claude-haiku-4.5");
    expect(row?.costCents).toBeCloseTo(60, 6);
    expect(row?.promptVersion).toBe("enrich.v2");
  });
});
