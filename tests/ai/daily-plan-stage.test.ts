import {
  PLAN_CANDIDATES,
  type PlanContext,
  candidateRank,
  toCandidate,
} from "@/lib/ai/plan/context";
import {
  DailyPlanOutput,
  MAX_PLAN_DECISIONS,
  TODAY_TARGET_SIZE,
  dailyPlanSystem,
  dailyPlanUser,
  offlineDailyPlan,
} from "@/lib/ai/plan/stage";
import { bucketFromScalars } from "@/lib/domain/priority";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import type { Task } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

const PLAN_DATE = "2026-10-13";

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  const urgency = overrides.urgency ?? 0.4;
  const importance = overrides.importance ?? 0.4;
  return {
    id: `task_${seq}`,
    sourceText: `source ${seq}`,
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency,
    importance,
    priorityBucket: bucketFromScalars(urgency, importance),
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function context(tasks: Task[], extra: Partial<PlanContext> = {}): PlanContext {
  return {
    planDate: PLAN_DATE,
    timeZone: "Europe/Ljubljana",
    candidates: tasks.map((t, i) => toCandidate(t, `t${i + 1}`, PLAN_DATE)),
    considered: tasks.length,
    notShown: 0,
    recentCompletions: [],
    preferences: [],
    ...extra,
  };
}

/** Today membership after applying a decision (or none) to a candidate. */
function afterToday(ctx: PlanContext, out: DailyPlanOutput, alias: string): boolean {
  const c = ctx.candidates.find((x) => x.alias === alias)!;
  const d = out.decisions.find((x) => x.alias === alias);
  const bucket = d ? bucketFromScalars(d.urgency, d.importance) : c.task.priorityBucket;
  return isTodayTaskOnDay({ ...c.task, priorityBucket: bucket }, PLAN_DATE);
}

describe("offline daily plan", () => {
  it("pulls in due-tomorrow deep work and pushes out score-only tasks due later", () => {
    const ctx = context([
      task({ title: "Write the board deck", due: "2026-10-14", effort: "deep" }),
      task({ title: "Renew passport", due: "2026-10-20", urgency: 0.8, importance: 0.8 }),
      task({ title: "Buy milk", effort: "quick" }),
    ]);
    const out = offlineDailyPlan(ctx);
    expect(ctx.candidates[1]!.inToday).toBe(true);
    expect(afterToday(ctx, out, "t1")).toBe(true);
    expect(afterToday(ctx, out, "t2")).toBe(false);
    expect(afterToday(ctx, out, "t3")).toBe(false);
    expect(out.decisions.find((d) => d.alias === "t1")?.reason).toBe("due tomorrow, deep work");
    expect(out.decisions.find((d) => d.alias === "t2")?.reason).toMatch(/due in 7d/);
    expect(out.summary).toContain("Write the board deck");
  });

  it("raises overdue and due-today tasks so Focus sorts them first", () => {
    const ctx = context([
      task({ due: "2026-10-10", urgency: 0.3, importance: 0.3 }),
      task({ due: PLAN_DATE, urgency: 0.3, importance: 0.3 }),
    ]);
    const out = offlineDailyPlan(ctx);
    expect(out.decisions.map((d) => d.reason)).toEqual(["overdue 3d", "due today"]);
    for (const d of out.decisions) {
      expect(d.urgency).toBeGreaterThanOrEqual(0.75);
      expect(d.importance).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("never touches a task whose priority the user set by hand", () => {
    const ctx = context([
      task({
        due: "2026-10-14",
        effort: "deep",
        editedFields: ["urgency"],
      }),
      task({ due: "2026-10-25", urgency: 0.9, importance: 0.9, editedFields: ["importance"] }),
    ]);
    expect(offlineDailyPlan(ctx).decisions).toEqual([]);
  });

  it("trims a crowded Today down to the target, lowest importance first", () => {
    const crowd = Array.from({ length: TODAY_TARGET_SIZE + 3 }, (_, i) =>
      task({ urgency: 0.9, importance: 0.6 + i * 0.03 }),
    );
    const ctx = context(crowd);
    const out = offlineDailyPlan(ctx);
    const demoted = out.decisions.filter((d) => d.reason.startsWith("Today is full"));
    expect(demoted).toHaveLength(3);
    // The three least important score-only tasks went.
    expect(demoted.map((d) => d.alias).sort()).toEqual(["t1", "t2", "t3"]);
    const stillIn = ctx.candidates.filter((c) => afterToday(ctx, out, c.alias)).length;
    expect(stillIn).toBe(TODAY_TARGET_SIZE);
  });

  it("deadline-forced tasks are never counted as demotable", () => {
    const forced = Array.from({ length: TODAY_TARGET_SIZE + 2 }, () =>
      task({ due: PLAN_DATE, urgency: 0.9, importance: 0.9 }),
    );
    const out = offlineDailyPlan(context(forced));
    expect(out.decisions).toEqual([]);
  });

  it("always parses against the output schema and caps decisions", () => {
    const many = Array.from({ length: MAX_PLAN_DECISIONS + 10 }, () =>
      task({ due: "2026-10-01", urgency: 0.1, importance: 0.1 }),
    );
    const out = offlineDailyPlan(context(many));
    expect(out.decisions.length).toBeLessThanOrEqual(MAX_PLAN_DECISIONS);
    expect(() => DailyPlanOutput.parse(out)).not.toThrow();
  });

  it("writes a quiet summary when nothing forces the day", () => {
    const out = offlineDailyPlan(context([task(), task()]));
    expect(out.summary).toMatch(/Nothing is forcing today/);
  });
});

describe("daily plan prompt", () => {
  it("names the plan date, flags Today membership and user-set fields, and counts the rest", () => {
    const ctx = context(
      [
        task({ title: "Pay the invoice", due: PLAN_DATE, urgency: 0.7, importance: 0.7 }),
        task({ title: "Call Ana", due: "2026-10-14", editedFields: ["urgency", "priorityBucket"] }),
        task({ title: "Someday novel", due: "2026-10-05" }),
      ],
      { notShown: 440, considered: 443, preferences: ["Prefers mornings for deep work"] },
    );
    const system = dailyPlanSystem(ctx);
    const user = dailyPlanUser(ctx);
    expect(system).toContain(PLAN_DATE);
    expect(user).toContain("Prefers mornings for deep work");
    expect(user).toContain("t1 [inbox] Pay the invoice — due today; u0.70 i0.70 small (TODAY)");
    expect(user).toContain("due tomorrow");
    expect(user).toContain("user-set: urgency, priorityBucket");
    expect(user).toContain("overdue 8d");
    expect(user).toContain("3 shown of 443");
    expect(user).toContain("and 440 more open tasks");
  });

  it("lists recent completions with their effort", () => {
    const ctx = context([task()], {
      recentCompletions: [
        { title: "Shipped the thing", effort: "deep", completedAt: "2026-10-12T20:00:00.000Z" },
      ],
    });
    expect(dailyPlanUser(ctx)).toContain("- Shipped the thing (deep, 2026-10-12)");
  });
});

describe("candidate ranking", () => {
  it("orders by deadline pressure, then bucket, then Focus membership", () => {
    const overdue = task({ due: "2026-10-01" });
    const dueSoon = task({ due: "2026-10-15" });
    const doNow = task({ urgency: 0.9, importance: 0.9 });
    const active = task({ lifecycle: "active" });
    const plain = task();
    const waiting = task({ lifecycle: "waiting" });
    const ranked = [waiting, plain, active, doNow, dueSoon, overdue]
      .map((t) => ({ t, rank: candidateRank(t, PLAN_DATE) }))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.t.id);
    expect(ranked).toEqual([overdue.id, dueSoon.id, doNow.id, active.id, plain.id, waiting.id]);
    expect(PLAN_CANDIDATES).toBeLessThanOrEqual(100);
  });
});
