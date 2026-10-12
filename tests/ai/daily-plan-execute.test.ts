import { PLAN_CANDIDATES, PLAN_READ_LIMITS, buildPlanContext } from "@/lib/ai/plan/context";
import {
  type DailyPlanInput,
  NO_OPEN_TASKS_SUMMARY,
  applyDailyPlanStep,
  beginDailyPlan,
  decideDailyPlan,
  failDailyPlan,
} from "@/lib/ai/plan/execute";
import { DAILY_PLAN_PROMPT_VERSION, MAX_TODAY_PROMOTIONS } from "@/lib/ai/plan/stage";
import type { Repos } from "@/lib/db/repos";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import type { Task } from "@/lib/domain/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
import { mockResolvedProvider } from "../helpers/ai";
import { getTestRepos } from "../setup";

/**
 * The `dailyPlan` step bodies against the in-memory repos. Without the
 * Workflow compiler `"use step"` is a no-op, so this is the code each step
 * runs, minus retries and the queue.
 */

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const PLAN_DATE = "2026-10-13";

async function seedUser(repos: Repos) {
  return repos.users.create({ email: "plan@example.com", displayName: "P", isCreator: false });
}

async function seedTask(
  repos: Repos,
  userId: string,
  title: string,
  patch: Partial<Task> = {},
  opts: { editedFields?: Task["editedFields"] } = {},
): Promise<Task> {
  const created = await repos.tasks.create(userId, { sourceText: title, sourceContext: null });
  const updated = await repos.tasks.update(
    userId,
    created.id,
    { aiStatus: "ready", title, ...patch },
    opts.editedFields ? { editedFields: opts.editedFields } : undefined,
  );
  return updated!;
}

/** What `enqueueDailyPlan` does before `start()`: reserve the billing row, claim the plan. */
async function claim(repos: Repos, userId: string, offline = true) {
  const reserved = await repos.aiRuns.insert({
    userId,
    taskId: null,
    promptVersion: DAILY_PLAN_PROMPT_VERSION,
    stage: "prioritize",
    model: "sifty.workflow",
    transport: "workflow",
    status: "succeeded",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: 0,
    offline,
    error: null,
  });
  const claimed = await repos.dailyPlans.claim({
    userId,
    planDate: PLAN_DATE,
    timezone: "Europe/Ljubljana",
    trigger: "manual",
    aiRunId: reserved.id,
  });
  if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
  const input: DailyPlanInput = {
    userId,
    planId: claimed.plan.id,
    aiRunId: reserved.id,
    planDate: PLAN_DATE,
    timeZone: "Europe/Ljubljana",
    trigger: "manual",
    modelPreference: null,
    offline,
  };
  return { plan: claimed.plan, input };
}

async function runWhole(input: DailyPlanInput) {
  expect(await beginDailyPlan(input, "wrun_1")).toBe("applied");
  const decided = await decideDailyPlan(input, "wrun_1");
  if ("skipped" in decided) throw new Error(`unexpected skip: ${decided.skipped}`);
  return { decided, outcome: await applyDailyPlanStep(input, decided) };
}

beforeEach(async () => {
  const { resolveProvider } = await import("@/lib/ai/provider");
  vi.mocked(resolveProvider).mockReset();
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("dailyPlan steps (offline)", () => {
  it("re-ranks the list, explains every move in task_events, and bills one prioritize run", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const deck = await seedTask(repos, user.id, "Write the board deck", {
      due: "2026-10-14",
      effort: "deep",
    });
    const passport = await seedTask(repos, user.id, "Renew passport", {
      due: "2026-10-20",
      urgency: 0.8,
      importance: 0.8,
    });
    const milk = await seedTask(repos, user.id, "Buy milk", { effort: "quick" });
    const { plan, input } = await claim(repos, user.id);

    const { outcome } = await runWhole(input);
    expect(outcome).toEqual({ outcome: "completed", moves: 2 });

    const finished = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(finished.status).toBe("completed");
    expect(finished.considered).toBe(3);
    expect(finished.workflowRunId).toBe("wrun_1");
    expect(finished.summary).toContain("Write the board deck");
    expect(finished.moves).toEqual([
      { taskId: deck.id, title: deck.title, kind: "moved_in", reason: "due tomorrow, deep work" },
      {
        taskId: passport.id,
        title: passport.title,
        kind: "moved_out",
        reason: "due in 7d; nothing forces it today",
      },
    ]);

    const deckAfter = (await repos.tasks.get(user.id, deck.id))!;
    expect(isTodayTaskOnDay(deckAfter, PLAN_DATE)).toBe(true);
    expect(deckAfter.rationale).toBe("Moved into Today: due tomorrow, deep work");
    const passportAfter = (await repos.tasks.get(user.id, passport.id))!;
    expect(isTodayTaskOnDay(passportAfter, PLAN_DATE)).toBe(false);
    expect(passportAfter.urgency).toBe(0.45);
    const milkAfter = (await repos.tasks.get(user.id, milk.id))!;
    expect(milkAfter.urgency).toBe(milk.urgency);
    expect(milkAfter.rationale).toBeNull();

    const events = await repos.taskEvents.list(user.id);
    expect(events.map((e) => [e.taskId, e.kind])).toEqual([
      [deck.id, "plan.moved_in"],
      [passport.id, "plan.moved_out"],
    ]);
    expect(events[0]!.payload).toMatchObject({
      planId: plan.id,
      planDate: PLAN_DATE,
      message: "Moved into Today: due tomorrow, deep work",
      before: { urgency: 0.4, importance: 0.4, priorityBucket: "unset" },
      after: { urgency: 0.7, importance: 0.6, priorityBucket: "do_now" },
    });
    expect(events[0]!.id).toBe(`evt_${plan.id}_${deck.id}`);

    const runs = await repos.aiRuns.list(user.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: input.aiRunId,
      stage: "prioritize",
      promptVersion: DAILY_PLAN_PROMPT_VERSION,
      model: "sifty.local.heuristic",
      taskId: null,
      siftId: null,
      workflowRunId: "wrun_1",
      status: "succeeded",
      offline: true,
    });
    expect(finished.aiRunId).toBe(input.aiRunId);
  });

  it("a retried apply step reports the same moves and writes no second event", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const deck = await seedTask(repos, user.id, "Deck", { due: "2026-10-14", effort: "deep" });
    const { plan, input } = await claim(repos, user.id);
    const { decided } = await runWhole(input);
    const again = await applyDailyPlanStep(input, decided);
    expect(again).toEqual({ outcome: "completed", moves: 1 });
    expect(await repos.taskEvents.list(user.id)).toHaveLength(1);
    const finished = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(finished.moves).toEqual([
      { taskId: deck.id, title: "Deck", kind: "moved_in", reason: "due tomorrow, deep work" },
    ]);
  });

  it("a retried decide step completes the same billing row instead of adding one", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    await seedTask(repos, user.id, "Deck", { due: "2026-10-14", effort: "deep" });
    const { input } = await claim(repos, user.id);
    await decideDailyPlan(input, "wrun_a");
    await decideDailyPlan(input, "wrun_b");
    const runs = await repos.aiRuns.list(user.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: input.aiRunId, workflowRunId: "wrun_b" });
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0); // offline rows do not count
  });

  it("never overrides a priority field the user edited", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const kept = await seedTask(
      repos,
      user.id,
      "User says low",
      { due: "2026-10-14", effort: "deep", urgency: 0.2, importance: 0.2 },
      { editedFields: ["urgency", "importance"] },
    );
    const { input } = await claim(repos, user.id);
    const { outcome } = await runWhole(input);
    expect(outcome).toEqual({ outcome: "completed", moves: 0 });
    const after = (await repos.tasks.get(user.id, kept.id))!;
    expect(after.urgency).toBe(0.2);
    expect(after.importance).toBe(0.2);
    expect(await repos.taskEvents.list(user.id)).toEqual([]);
  });

  it("skips tasks that are mid-sift: their own prioritize stage owns them", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const sifting = await seedTask(repos, user.id, "Being sifted", {
      due: "2026-10-14",
      effort: "deep",
      aiStatus: "running",
    });
    const { input } = await claim(repos, user.id);
    expect(await beginDailyPlan(input, null)).toBe("applied");
    const decided = await decideDailyPlan(input, null);
    expect(decided).toEqual({ skipped: "no_open_tasks" });
    expect((await repos.tasks.get(user.id, sifting.id))!.urgency).toBe(0.4);
  });

  it("marks the plan completed with a quiet summary when nothing is open", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const { plan, input } = await claim(repos, user.id);
    const { skipDailyPlan } = await import("@/lib/ai/plan/execute");
    const decided = await decideDailyPlan(input, null);
    expect(decided).toEqual({ skipped: "no_open_tasks" });
    expect(await skipDailyPlan(input, "no_open_tasks")).toEqual({
      outcome: "skipped",
      reason: "no_open_tasks",
    });
    const after = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(after.status).toBe("completed");
    expect(after.summary).toBe(NO_OPEN_TASKS_SUMMARY);
    // The reserved billing row is released: nothing was asked of the model.
    const [reserved] = await repos.aiRuns.list(user.id);
    expect(reserved).toMatchObject({ id: input.aiRunId, status: "failed" });
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
  });

  it("a user with 500 open tasks is planned within bounded reads and a bounded prompt", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    for (let i = 0; i < 500; i += 1) {
      const due = i % 5 === 0 ? `2026-10-${String(10 + (i % 9)).padStart(2, "0")}` : null;
      await seedTask(repos, user.id, `Task ${i}`, {
        due,
        urgency: (i % 10) / 10,
        importance: ((i * 7) % 10) / 10,
      });
    }
    const list = vi.spyOn(repos.tasks, "list");
    const ctx = await buildPlanContext(repos, user.id, PLAN_DATE, "UTC");
    for (const call of list.mock.calls) {
      expect(call[1]?.limit).toBeDefined();
      expect(call[1]!.limit!).toBeLessThanOrEqual(
        Math.max(PLAN_READ_LIMITS.deadline, PLAN_READ_LIMITS.recent),
      );
    }
    expect(ctx.candidates.length).toBeLessThanOrEqual(PLAN_CANDIDATES);
    expect(ctx.considered).toBeLessThanOrEqual(PLAN_READ_LIMITS.deadline + PLAN_READ_LIMITS.recent);
    expect(ctx.notShown).toBe(ctx.considered - ctx.candidates.length);
    // Every overdue task made the cut ahead of the undated backlog.
    const overdue = ctx.candidates.filter((c) => c.daysUntilDue !== null && c.daysUntilDue < 0);
    expect(overdue.length).toBeGreaterThan(0);
    expect(
      ctx.candidates.every((c) => c.daysUntilDue !== null || c.task.priorityBucket !== "drop"),
    ).toBe(true);

    const { plan, input } = await claim(repos, user.id);
    list.mockClear();
    const { outcome } = await runWhole(input);
    expect(outcome.outcome).toBe("completed");
    expect(list.mock.calls.every((c) => c[1]?.limit !== undefined)).toBe(true);
    const finished = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(finished.considered).toBe(ctx.considered);
    expect(finished.moves.length).toBeLessThanOrEqual(20);
    expect(await repos.aiRuns.list(user.id)).toHaveLength(1);
  });
});

describe("dailyPlan steps (model)", () => {
  async function mockModel(output: unknown) {
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("prioritize"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: output,
      usage: { inputTokens: 900, outputTokens: 120 },
      response: { modelId: "claude-haiku-4-5-20251001" },
    } as never);
  }

  it("applies the model's decisions by alias, drops hallucinated aliases, snoozes, and over-cap promotions", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    // t1: due today (ranks first), t2: due in 5 days (snoozed), then 9 undated.
    const today = await seedTask(repos, user.id, "Due today", { due: PLAN_DATE });
    const parked = await seedTask(repos, user.id, "Parked", { due: "2026-10-18" });
    const undated: Task[] = [];
    for (let i = 0; i < MAX_TODAY_PROMOTIONS + 1; i += 1) {
      undated.push(await seedTask(repos, user.id, `Undated ${i}`, { importance: 0.5 - i * 0.01 }));
    }
    const ctx = await buildPlanContext(repos, user.id, PLAN_DATE, "UTC");
    const alias = (id: string) => ctx.candidates.find((c) => c.task.id === id)!.alias;

    await mockModel({
      summary: "Lead with the invoice; the rest can wait.",
      decisions: [
        { alias: alias(today.id), urgency: 0.9, importance: 0.9, reason: "due today" },
        { alias: alias(parked.id), urgency: 0.9, importance: 0.9, reason: "feels urgent" },
        ...undated.map((t) => ({
          alias: alias(t.id),
          urgency: 0.8,
          importance: 0.7,
          reason: "important, no deadline",
        })),
        { alias: "t99", urgency: 0.9, importance: 0.9, reason: "made up" },
      ],
    });

    const { plan, input } = await claim(repos, user.id, false);
    const { outcome } = await runWhole(input);
    expect(outcome.outcome).toBe("completed");

    const finished = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(finished.summary).toBe("Lead with the invoice; the rest can wait.");
    const kinds = finished.moves.map((m) => m.kind);
    expect(kinds.filter((k) => k === "rescored")).toHaveLength(1);
    expect(kinds.filter((k) => k === "moved_in")).toHaveLength(MAX_TODAY_PROMOTIONS);
    expect(finished.moves.some((m) => m.taskId === parked.id)).toBe(false);
    expect((await repos.tasks.get(user.id, parked.id))!.urgency).toBe(0.4);

    const runs = await repos.aiRuns.list(user.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      stage: "prioritize",
      model: "anthropic/claude-haiku-4.5",
      transport: "gateway",
      inputTokens: 900,
      outputTokens: 120,
      offline: false,
    });
    expect(runs[0]!.costCents).toBeGreaterThan(0);
  });

  it("an alias resolves to the task the model saw, even after the list re-ranks", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const first = await seedTask(repos, user.id, "Ranked first", { due: "2026-10-14" });
    const second = await seedTask(repos, user.id, "Ranked second", { due: "2026-10-16" });
    const ctx = await buildPlanContext(repos, user.id, PLAN_DATE, "UTC");
    expect(ctx.candidates.map((c) => c.task.id)).toEqual([first.id, second.id]);
    const secondAlias = ctx.candidates[1]!.alias;
    await mockModel({
      summary: "One change.",
      decisions: [{ alias: secondAlias, urgency: 0.9, importance: 0.9, reason: "due in 3d" }],
    });
    const { input } = await claim(repos, user.id, false);
    expect(await beginDailyPlan(input, null)).toBe("applied");
    const decided = await decideDailyPlan(input, null);
    if ("skipped" in decided) throw new Error("unexpected skip");
    expect(decided.aliases[secondAlias]).toBe(second.id);

    // Between decide and apply the second task becomes overdue and would now
    // rank first — the decision must still land on it, not on `first`.
    await repos.tasks.update(user.id, second.id, { due: "2026-10-01" });
    const outcome = await applyDailyPlanStep(input, decided);
    expect(outcome).toEqual({ outcome: "completed", moves: 1 });
    expect((await repos.tasks.get(user.id, second.id))!.urgency).toBe(0.9);
    expect((await repos.tasks.get(user.id, first.id))!.urgency).toBe(0.4);
  });

  it("a task completed or parked between decide and apply is left alone", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const done = await seedTask(repos, user.id, "Finished meanwhile");
    const parked = await seedTask(repos, user.id, "Parked meanwhile");
    const ctx = await buildPlanContext(repos, user.id, PLAN_DATE, "UTC");
    const alias = (id: string) => ctx.candidates.find((c) => c.task.id === id)!.alias;
    await mockModel({
      summary: "Two changes.",
      decisions: [done.id, parked.id].map((id) => ({
        alias: alias(id),
        urgency: 0.9,
        importance: 0.9,
        reason: "matters",
      })),
    });
    const { plan, input } = await claim(repos, user.id, false);
    expect(await beginDailyPlan(input, null)).toBe("applied");
    const decided = await decideDailyPlan(input, null);
    if ("skipped" in decided) throw new Error("unexpected skip");
    await repos.tasks.update(user.id, done.id, { lifecycle: "done" });
    await repos.tasks.update(user.id, parked.id, { lifecycle: "someday" });
    expect(await applyDailyPlanStep(input, decided)).toEqual({ outcome: "completed", moves: 0 });
    expect((await repos.tasks.get(user.id, done.id))!.urgency).toBe(0.4);
    expect((await repos.tasks.get(user.id, done.id))!.rationale).toBeNull();
    expect((await repos.tasks.get(user.id, parked.id))!.urgency).toBe(0.4);
    expect(await repos.taskEvents.list(user.id)).toEqual([]);
    expect((await repos.dailyPlans.get(user.id, plan.id))!.moves).toEqual([]);
  });

  it("a promotion that is skipped at write time does not spend a promotion slot", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    const undated: Task[] = [];
    for (let i = 0; i < MAX_TODAY_PROMOTIONS + 1; i += 1) {
      undated.push(await seedTask(repos, user.id, `Undated ${i}`));
    }
    const ctx = await buildPlanContext(repos, user.id, PLAN_DATE, "UTC");
    const alias = (id: string) => ctx.candidates.find((c) => c.task.id === id)!.alias;
    await mockModel({
      summary: "Everything in.",
      decisions: undated.map((t) => ({
        alias: alias(t.id),
        urgency: 0.8,
        importance: 0.7,
        reason: "important, no deadline",
      })),
    });
    const { input } = await claim(repos, user.id, false);
    expect(await beginDailyPlan(input, null)).toBe("applied");
    const decided = await decideDailyPlan(input, null);
    if ("skipped" in decided) throw new Error("unexpected skip");
    // The first decided task disappears before apply.
    const firstDecided = decided.aliases[decided.output.decisions[0]!.alias]!;
    await repos.tasks.delete(user.id, firstDecided);
    const outcome = await applyDailyPlanStep(input, decided);
    expect(outcome).toEqual({ outcome: "completed", moves: MAX_TODAY_PROMOTIONS });
  });

  it("a provider failure records a failed run and rethrows for Workflow's retry", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    await seedTask(repos, user.id, "Anything");
    const { resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("prioritize"));
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValue(new Error("upstream 503"));

    const { plan, input } = await claim(repos, user.id, false);
    await expect(decideDailyPlan(input, "wrun_x")).rejects.toThrow("upstream 503");
    const runs = await repos.aiRuns.list(user.id);
    expect(runs[0]).toMatchObject({ status: "failed", error: "upstream 503", stage: "prioritize" });

    await failDailyPlan(input, "upstream 503");
    const after = (await repos.dailyPlans.get(user.id, plan.id))!;
    expect(after.status).toBe("failed");
    expect(after.error).toBe("upstream 503");
    expect(after.finishedAt).not.toBeNull();
  });

  it("operator misconfiguration is fatal, not retried", async () => {
    const repos = getTestRepos();
    const user = await seedUser(repos);
    await seedTask(repos, user.id, "Anything");
    const { AiConfigError, resolveProvider } = await import("@/lib/ai/provider");
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new AiConfigError("AI_TRANSPORT is wrong");
    });
    const { input } = await claim(repos, user.id, false);
    await expect(decideDailyPlan(input, null)).rejects.toBeInstanceOf(FatalError);
  });
});
