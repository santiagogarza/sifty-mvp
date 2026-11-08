import type { Task } from "@/lib/domain/types";
import {
  computeTaskCounts,
  isTodayTask,
  selectByLifecycle,
  selectFocusTasks,
  selectInboxTasks,
  selectSnoozedTasks,
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
    snoozedUntil: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
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
    expect(counts.today).toBe(selectTodayTasks(tasks).length);
    expect(counts.today).toBe(3);
  });
});

describe("snooze", () => {
  const snoozedTasks = () => [
    makeTask({ lifecycle: "inbox", priorityBucket: "do_now", snoozedUntil: iso(3) }),
    makeTask({ lifecycle: "active", due: iso(-1), snoozedUntil: iso(1) }),
    makeTask({ lifecycle: "waiting", due: iso(0), snoozedUntil: iso(2) }),
    makeTask({ lifecycle: "someday", snoozedUntil: iso(5) }),
  ];

  it("hides snoozed tasks from every open view, deadlines included", () => {
    const tasks = snoozedTasks();
    const args = { now: NOW };
    expect(selectTodayTasks(tasks, args)).toEqual([]);
    expect(selectInboxTasks(tasks, args)).toEqual([]);
    expect(selectFocusTasks(tasks, args)).toEqual([]);
    expect(selectByLifecycle(tasks, "waiting", args)).toEqual([]);
    expect(selectByLifecycle(tasks, "someday", args)).toEqual([]);
  });

  it("lists snoozed tasks in Snoozed, soonest wake day first", () => {
    const tasks = snoozedTasks();
    expect(selectSnoozedTasks(tasks, { now: NOW }).map((t) => t.snoozedUntil)).toEqual([
      iso(1),
      iso(2),
      iso(3),
      iso(5),
    ]);
  });

  it("ignores snooze for done and dropped tasks", () => {
    const done = makeTask({ lifecycle: "done", snoozedUntil: iso(2) });
    const dropped = makeTask({ lifecycle: "dropped", snoozedUntil: iso(2) });
    expect(selectSnoozedTasks([done, dropped], { now: NOW })).toEqual([]);
    expect(selectByLifecycle([dropped], "dropped", { now: NOW })).toEqual([dropped]);
  });

  it("wakes a task on its wake day, back in its own status", () => {
    const task = makeTask({ lifecycle: "active", snoozedUntil: iso(2) });
    const dayBefore = new Date(NOW);
    dayBefore.setDate(dayBefore.getDate() + 1);
    const wakeDay = new Date(NOW);
    wakeDay.setDate(wakeDay.getDate() + 2);

    expect(selectFocusTasks([task], { now: dayBefore })).toEqual([]);
    expect(selectFocusTasks([task], { now: wakeDay })).toEqual([task]);
    expect(selectSnoozedTasks([task], { now: wakeDay })).toEqual([]);
    // A past wake day is simply not snoozed.
    expect(
      selectFocusTasks([makeTask({ lifecycle: "active", snoozedUntil: iso(-3) })], { now: NOW }),
    ).toHaveLength(1);
  });

  it("keeps counts in agreement with the lists", () => {
    const tasks = [
      ...snoozedTasks(),
      makeTask({ lifecycle: "inbox", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "done", snoozedUntil: iso(1) }),
    ];
    const counts = computeTaskCounts(tasks, NOW);
    const args = { now: NOW };
    expect(counts).toMatchObject({
      today: selectTodayTasks(tasks, args).length,
      inbox: selectInboxTasks(tasks, args).length,
      focus: selectFocusTasks(tasks, args).length,
      waiting: selectByLifecycle(tasks, "waiting", args).length,
      someday: selectByLifecycle(tasks, "someday", args).length,
      snoozed: selectSnoozedTasks(tasks, args).length,
      done: 1,
    });
    expect(counts).toMatchObject({ today: 1, inbox: 1, focus: 1, snoozed: 4 });
  });
});
