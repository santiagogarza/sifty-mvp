import type { Task } from "@/lib/domain/types";
import {
  computeTaskCounts,
  isSnoozed,
  isTodayTask,
  selectFocusTasks,
  selectInboxTasks,
  selectTodayTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/**
 * View-routing contract: every sidebar view except Today maps 1:1 to a
 * status, and the Today list and sidebar count share one predicate.
 */

const NOW = new Date("2026-07-22T12:00:00Z");

function iso(daysFromNow: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_test_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    snoozeUntil: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    recurrence: null,
    seriesId: null,
    siftedWithAssumptions: false,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    ...patch,
  };
}

describe("isTodayTask", () => {
  it("surfaces inbox/active tasks that are overdue, due today, or do_now", () => {
    expect(isTodayTask(makeTask({ lifecycle: "inbox", due: iso(-1) }), NOW)).toBe(true);
    expect(isTodayTask(makeTask({ lifecycle: "active", due: iso(0) }), NOW)).toBe(true);
    expect(isTodayTask(makeTask({ lifecycle: "inbox", priorityBucket: "do_now" }), NOW)).toBe(true);
    expect(isTodayTask(makeTask({ lifecycle: "active", due: iso(3) }), NOW)).toBe(false);
    expect(isTodayTask(makeTask({ lifecycle: "inbox" }), NOW)).toBe(false);
  });

  it("surfaces waiting tasks only when a deadline forces them", () => {
    expect(isTodayTask(makeTask({ lifecycle: "waiting", due: iso(-2) }), NOW)).toBe(true);
    expect(isTodayTask(makeTask({ lifecycle: "waiting", due: iso(0) }), NOW)).toBe(true);
    // Waiting + do_now without a date stays out — the ball is elsewhere.
    expect(isTodayTask(makeTask({ lifecycle: "waiting", priorityBucket: "do_now" }), NOW)).toBe(
      false,
    );
  });

  it("never resurfaces someday, done, or dropped tasks", () => {
    for (const lifecycle of ["someday", "done", "dropped"] as const) {
      const task = makeTask({ lifecycle, due: iso(-1), priorityBucket: "do_now" });
      expect(isTodayTask(task, NOW)).toBe(false);
    }
  });
});

describe("selectFocusTasks", () => {
  it("is exactly the active status — inbox stays the review gate", () => {
    const active = makeTask({ lifecycle: "active" });
    const tasks = [
      active,
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "done" }),
    ];
    expect(selectFocusTasks(tasks).map((t) => t.id)).toEqual([active.id]);
  });
});

describe("computeTaskCounts", () => {
  it("agrees with the Today list and counts each status once", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", due: iso(-1) }), // today
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }), // today
      makeTask({ lifecycle: "waiting", due: iso(0) }), // today (deadline)
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday", due: iso(-3) }), // never today
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
      makeTask({ lifecycle: "dropped" }),
    ];
    const counts = computeTaskCounts(tasks, NOW);
    expect(counts).toMatchObject({
      inbox: 2,
      focus: 1,
      waiting: 2,
      someday: 1,
      done: 1,
      dropped: 1,
      total: 8,
    });
    // The sidebar badge and the Today list can never disagree.
    expect(counts.today).toBe(selectTodayTasks(tasks, {}, NOW).length);
    expect(counts.today).toBe(3);
  });
});

describe("snoozeUntil", () => {
  const wake = "2026-07-23";
  const beforeWake = new Date(2026, 6, 23, 7, 59, 0);
  const atWake = new Date(2026, 6, 23, 8, 0, 0);

  it("hides a snoozed inbox task from Inbox, Today, and both counts", () => {
    const task = makeTask({
      lifecycle: "inbox",
      priorityBucket: "do_now",
      snoozeUntil: "2026-07-30",
    });
    expect(isSnoozed(task, NOW)).toBe(true);
    expect(selectInboxTasks([task], {}, NOW)).toEqual([]);
    expect(selectTodayTasks([task], {}, NOW)).toEqual([]);
    expect(isTodayTask(task, NOW)).toBe(false);
    const counts = computeTaskCounts([task], NOW);
    expect(counts.inbox).toBe(0);
    expect(counts.today).toBe(0);
    expect(counts.today).toBe(selectTodayTasks([task], {}, NOW).length);
  });

  it("stays hidden at 7:59 on the wake day and returns at 8:00", () => {
    const task = makeTask({
      lifecycle: "inbox",
      priorityBucket: "do_now",
      snoozeUntil: wake,
    });
    expect(isSnoozed(task, beforeWake)).toBe(true);
    expect(selectInboxTasks([task], {}, beforeWake)).toEqual([]);
    expect(selectTodayTasks([task], {}, beforeWake)).toEqual([]);
    expect(computeTaskCounts([task], beforeWake)).toMatchObject({ inbox: 0, today: 0 });

    expect(isSnoozed(task, atWake)).toBe(false);
    expect(selectInboxTasks([task], {}, atWake).map((t) => t.id)).toEqual([task.id]);
    expect(selectTodayTasks([task], {}, atWake).map((t) => t.id)).toEqual([task.id]);
    const counts = computeTaskCounts([task], atWake);
    expect(counts.inbox).toBe(1);
    expect(counts.today).toBe(selectTodayTasks([task], {}, atWake).length);
    expect(counts.today).toBe(1);
  });

  it("keeps a snoozed focus task in Focus and out of Today", () => {
    const task = makeTask({
      lifecycle: "active",
      priorityBucket: "do_now",
      snoozeUntil: "2026-07-30",
    });
    expect(selectFocusTasks([task]).map((t) => t.id)).toEqual([task.id]);
    expect(selectTodayTasks([task], {}, NOW)).toEqual([]);
    expect(isTodayTask(task, NOW)).toBe(false);
    const counts = computeTaskCounts([task], NOW);
    expect(counts.focus).toBe(1);
    expect(counts.today).toBe(0);
    expect(counts.today).toBe(selectTodayTasks([task], {}, NOW).length);
  });
});
