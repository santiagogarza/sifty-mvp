import { type MemoryExtractInput, extractMemories } from "@/lib/ai/memory/execute";
import { MIN_MEMORY_CONFIDENCE, type MemoryProposal } from "@/lib/ai/memory/extract";
import { type MemoryProposalSource, setMemorySinkForTesting } from "@/lib/ai/memory/propose";
import type { Repos } from "@/lib/db/repos";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { FREE_SIFTS_PER_DAY, emptySnapshot } from "@/lib/entitlements/entitlements";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { memoryFromEdit } from "@/lib/workflows/memory-from-edit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
import { mockResolvedProvider } from "../helpers/ai";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * The memory-extraction step body against the in-memory repos, and the
 * edit trigger in `PATCH /api/tasks/:id`. Proposals are captured through
 * the sink seam; the Decisions inbox is the production sink.
 */

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const filed: Array<{ userId: string; proposals: MemoryProposal[]; source: MemoryProposalSource }> =
  [];

beforeEach(async () => {
  filed.length = 0;
  setMemorySinkForTesting(async (_repos, userId, proposals, source) => {
    filed.push({ userId, proposals, source });
    return { filed: proposals.length };
  });
  const { resolveProvider } = await import("@/lib/ai/provider");
  vi.mocked(resolveProvider).mockReset();
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();
});

afterEach(() => {
  setMemorySinkForTesting(null);
  vi.unstubAllEnvs();
});

async function seedSifted(repos: Repos, userId: string, sourceText: string, siftId = "sift_1") {
  const created = await repos.tasks.create(userId, { sourceText, sourceContext: null });
  const task = await repos.tasks.update(userId, created.id, {
    aiStatus: "ready",
    siftId,
    urgency: 0.8,
    importance: 0.7,
  });
  // The sift's own accounting row, so cap counting can be checked.
  await repos.aiRuns.insert({
    userId,
    taskId: created.id,
    promptVersion: "sift.v1",
    stage: SIFT_ACCOUNTING_STAGE,
    siftId,
    model: "sifty.workflow",
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline: false,
    error: null,
  });
  return task!;
}

function input(userId: string, taskId: string, overrides: Partial<MemoryExtractInput> = {}) {
  return {
    userId,
    taskId,
    siftId: "sift_1",
    trigger: "sift" as const,
    contradictions: [],
    modelPreference: null,
    offline: true,
    ...overrides,
  };
}

describe("extractMemories (offline)", () => {
  it("files proposals through the sink and records one detail row that is not a billing unit", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m@example.com",
      displayName: "M",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Send the Q3 numbers to Ana, my accountant");
    const before = await repos.aiRuns.countSucceededToday(user.id);

    const outcome = await extractMemories(input(user.id, task.id), "wrun_m");
    expect(outcome).toEqual({ outcome: "proposed", proposals: 1, filed: 1 });
    expect(filed).toHaveLength(1);
    expect(filed[0]!.proposals[0]).toMatchObject({ text: "Ana = accountant", kind: "fact" });
    expect(filed[0]!.source).toEqual({ taskId: task.id, siftId: "sift_1", trigger: "sift" });

    const runs = await repos.aiRuns.list(user.id);
    const memoryRun = runs.find((r) => r.stage === "memory");
    expect(memoryRun).toMatchObject({
      promptVersion: "memory.v1",
      siftId: "sift_1",
      taskId: task.id,
      workflowRunId: "wrun_m",
      status: "succeeded",
    });
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(before);
  });

  it("the prefilter stops mundane captures before any model call or ai_runs row", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m2@example.com",
      displayName: "M",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Buy milk");
    expect(await extractMemories(input(user.id, task.id), null)).toEqual({
      outcome: "skipped",
      reason: "prefilter",
    });
    expect((await repos.aiRuns.list(user.id)).some((r) => r.stage === "memory")).toBe(false);
    expect(filed).toEqual([]);
  });

  it("an edit-triggered run skips the prefilter and never re-proposes an existing memory", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m3@example.com",
      displayName: "M",
      isCreator: false,
    });
    await repos.memories.create(user.id, { text: "Treats invoice tasks as low urgency" });
    const task = await seedSifted(repos, user.id, "Pay the October invoice");
    const outcome = await extractMemories(
      input(user.id, task.id, {
        trigger: "edit",
        contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.2 }],
      }),
      null,
    );
    expect(outcome).toEqual({ outcome: "skipped", reason: "nothing" });
    expect((await repos.aiRuns.list(user.id)).some((r) => r.stage === "memory")).toBe(true);
    expect(filed).toEqual([]);
  });

  it("stops when the task is gone or a re-sift superseded this one", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m4@example.com",
      displayName: "M",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Call Ana, my accountant", "sift_2");
    expect(await extractMemories(input(user.id, task.id), null)).toEqual({
      outcome: "skipped",
      reason: "superseded",
    });
    expect(await extractMemories(input(user.id, "task_nope"), null)).toEqual({
      outcome: "skipped",
      reason: "missing",
    });
  });
});

describe("extractMemories (model)", () => {
  it("shows the model only pinned memories; unpinned ones still dedupe locally", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "pin@example.com",
      displayName: "M",
      isCreator: false,
    });
    await repos.memories.create(user.id, { text: "Prefers mornings for deep work", pinned: true });
    await repos.memories.create(user.id, { text: "Private: therapist on Tuesdays", pinned: false });
    await repos.memories.create(user.id, { text: "Ana is the user's accountant", pinned: false });
    const task = await seedSifted(repos, user.id, "Ask Ana, my accountant, about VAT");
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("memory"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        proposals: [
          {
            text: "ana is the user's accountant",
            kind: "fact",
            evidence: "Ana, my accountant",
            confidence: 0.9,
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      response: { modelId: "claude-haiku-4-5-20251001" },
    } as never);

    const outcome = await extractMemories(input(user.id, task.id, { offline: false }), null);
    const call = vi.mocked(generateObject).mock.calls[0]![0] as { prompt: string };
    expect(call.prompt).toContain("Prefers mornings for deep work");
    expect(call.prompt).not.toContain("therapist");
    expect(call.prompt).not.toContain("Ana is the user's accountant");
    // The unpinned duplicate still blocks the proposal.
    expect(outcome).toEqual({ outcome: "skipped", reason: "nothing" });
  });

  it("applies the confidence floor, dedupes, and prices the run", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m5@example.com",
      displayName: "M",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Ask Ana, my accountant, about VAT");
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("memory"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        proposals: [
          {
            text: "Ana is the user's accountant",
            kind: "fact",
            evidence: "Ana, my accountant",
            confidence: 0.9,
          },
          {
            text: "Dislikes VAT",
            kind: "preference",
            evidence: "VAT",
            confidence: MIN_MEMORY_CONFIDENCE - 0.1,
          },
          { text: "ana is the user's accountant", kind: "fact", evidence: "dup", confidence: 0.8 },
        ],
      },
      usage: { inputTokens: 600, outputTokens: 80 },
      response: { modelId: "claude-haiku-4-5-20251001" },
    } as never);

    const outcome = await extractMemories(input(user.id, task.id, { offline: false }), "wrun_x");
    expect(outcome).toEqual({ outcome: "proposed", proposals: 1, filed: 1 });
    expect(filed[0]!.proposals.map((p) => p.text)).toEqual(["Ana is the user's accountant"]);
    const run = (await repos.aiRuns.list(user.id)).find((r) => r.stage === "memory")!;
    expect(run).toMatchObject({
      model: "anthropic/claude-haiku-4.5",
      inputTokens: 600,
      outputTokens: 80,
    });
    expect(run.costCents).toBeGreaterThan(0);
  });

  it("a provider failure records a failed row and rethrows; misconfiguration is fatal", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "m6@example.com",
      displayName: "M",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Ask Ana, my accountant, about VAT");
    const { AiConfigError, resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("memory"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValueOnce(new Error("upstream 502"));
    await expect(
      extractMemories(input(user.id, task.id, { offline: false }), null),
    ).rejects.toThrow("upstream 502");
    const failedRun = (await repos.aiRuns.list(user.id)).find((r) => r.stage === "memory")!;
    expect(failedRun).toMatchObject({ status: "failed", error: "upstream 502", siftId: "sift_1" });

    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new AiConfigError("no key");
    });
    await expect(
      extractMemories(input(user.id, task.id, { offline: false }), null),
    ).rejects.toBeInstanceOf(FatalError);
  });
});

describe("PATCH /api/tasks/:id starts memoryFromEdit on a contradicting edit", () => {
  const client = {
    start: vi.fn<WorkflowClient["start"]>(),
    wait: vi.fn<WorkflowClient["wait"]>(),
    resume: vi.fn<WorkflowClient["resume"]>(),
  };

  beforeEach(() => {
    __resetRateLimits();
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
    client.start.mockReset();
    client.start.mockResolvedValue({ runId: "wrun_edit" });
    setWorkflowClientForTesting(client);
  });
  afterEach(() => setWorkflowClientForTesting(null));

  async function patch(cookie: string, id: string, body: Record<string, unknown>) {
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    return PATCH(
      new Request(`http://localhost/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("fires once per task and sift, only for signal fields, and never blocks the edit", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "edit@example.com" });
    const task = await seedSifted(repos, user.id, "Pay the October invoice");

    // A title edit is not a contradiction.
    expect(
      (await patch(cookie, task.id, { title: "Pay invoice", editedFields: ["title"] })).status,
    ).toBe(200);
    expect(client.start).not.toHaveBeenCalled();

    // Lowering the sift's urgency is.
    const res = await patch(cookie, task.id, { urgency: 0.2, editedFields: ["urgency"] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { task: { urgency: number } }).task.urgency).toBe(0.2);
    expect(client.start).toHaveBeenCalledTimes(1);
    const started = client.start.mock.calls[0]!;
    expect(started[0]).toBe(memoryFromEdit);
    expect(started[1][0]).toMatchObject({
      userId: user.id,
      taskId: task.id,
      siftId: "sift_1",
      trigger: "edit",
      contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.2 }],
      modelPreference: null,
      offline: false,
    });
    // The cap unit was reserved before the run started and already counts.
    expect((started[1][0] as { aiRunId?: string }).aiRunId).toBeTruthy();
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(2); // the sift + this run
    const events = await repos.taskEvents.listForTask(user.id, task.id, 10);
    expect(events.map((e) => e.kind)).toEqual(["memory.extracted"]);

    // A second contradiction on the same sift (importance this time) does not fire again.
    expect(
      (await patch(cookie, task.id, { importance: 0.1, editedFields: ["importance"] })).status,
    ).toBe(200);
    expect(client.start).toHaveBeenCalledTimes(1);

    // The queue being down never fails the edit.
    const other = await seedSifted(repos, user.id, "Send the newsletter", "sift_9");
    client.start.mockRejectedValueOnce(new Error("queue down"));
    expect(
      (await patch(cookie, other.id, { effort: "quick", editedFields: ["effort"] })).status,
    ).toBe(200);
  });

  it("an edit at the daily cap starts nothing, and the edit still succeeds", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "capped@example.com" });
    await repos.entitlements.upsert(user.id, emptySnapshot());
    for (let i = 0; i < FREE_SIFTS_PER_DAY; i += 1) {
      await repos.aiRuns.insert({
        userId: user.id,
        taskId: null,
        promptVersion: "sift.v1",
        stage: SIFT_ACCOUNTING_STAGE,
        siftId: `sift_cap_${i}`,
        model: "sifty.workflow",
        transport: "workflow",
        status: "succeeded",
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        costCents: 0,
        offline: false,
        error: null,
      });
    }
    const task = await seedSifted(repos, user.id, "Pay the October invoice", "sift_c");
    const res = await patch(cookie, task.id, { urgency: 0.2, editedFields: ["urgency"] });
    expect(res.status).toBe(200);
    expect(client.start).not.toHaveBeenCalled();
    // No marker either: the next edit after the cap resets may still extract.
    expect(await repos.taskEvents.listForTask(user.id, task.id, 10)).toEqual([]);
  });

  it("two first-time edits racing on the same sift start exactly one run", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "race-edit@example.com" });
    const task = await seedSifted(repos, user.id, "Pay the October invoice", "sift_r");
    const [a, b] = await Promise.all([
      patch(cookie, task.id, { urgency: 0.2, editedFields: ["urgency"] }),
      patch(cookie, task.id, { importance: 0.1, editedFields: ["importance"] }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(await repos.taskEvents.listForTask(user.id, task.id, 10)).toHaveLength(1);
  });

  it("an edit-triggered run completes its reserved row in place; a retry or a failure never adds a unit", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "bill@example.com",
      displayName: "B",
      isCreator: false,
    });
    const task = await seedSifted(repos, user.id, "Pay the October invoice");
    const reserve = () =>
      repos.aiRuns.insert({
        userId: user.id,
        taskId: task.id,
        promptVersion: "memory.v1",
        stage: "memory",
        model: "sifty.workflow",
        transport: "workflow",
        status: "succeeded",
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        costCents: 0,
        offline: true,
        error: null,
      });
    const reserved = await reserve();
    const before = await repos.aiRuns.countSucceededToday(user.id);
    const run = input(user.id, task.id, {
      trigger: "edit",
      offline: true,
      aiRunId: reserved.id,
      contradictions: [{ field: "urgency", aiValue: 0.8, userValue: 0.2 }],
    });
    // A sink failure on the first attempt, then a clean retry.
    setMemorySinkForTesting(async () => {
      throw new Error("inbox down");
    });
    await expect(extractMemories(run, "wrun_1")).rejects.toThrow("inbox down");
    setMemorySinkForTesting(async (_r, _u, proposals) => ({ filed: proposals.length }));
    expect(await extractMemories(run, "wrun_2")).toEqual({
      outcome: "proposed",
      proposals: 1,
      filed: 1,
    });

    const rows = (await repos.aiRuns.list(user.id)).filter((r) => r.stage === "memory");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: reserved.id,
      siftId: null,
      status: "succeeded",
      workflowRunId: "wrun_2",
    });
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(before);

    // A superseded run releases its reservation.
    const other = await reserve();
    expect(
      await extractMemories({ ...run, siftId: "sift_stale", aiRunId: other.id }, null),
    ).toEqual({ outcome: "skipped", reason: "superseded" });
    expect((await repos.aiRuns.list(user.id)).find((r) => r.id === other.id)!.status).toBe(
      "failed",
    );
  });
});
