import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  computeTaskCounts,
  isTodayTask,
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectDroppedTasks,
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

describe("selectBoardColumns", () => {
  const ids = (tasks: Task[]) => tasks.map((t) => t.id);

  it("has one column per status, in pipeline order, even when empty", () => {
    expect(selectBoardColumns([]).map((c) => c.status)).toEqual([...STATUSES_IN_ORDER]);
    expect(selectBoardColumns([]).every((c) => c.tasks.length === 0)).toBe(true);
  });

  it("places every task once, in its status column, ordered like that status's list", () => {
    const olderInbox = makeTask({ lifecycle: "inbox", createdAt: "2026-07-20T09:00:00Z" });
    const newerInbox = makeTask({ lifecycle: "inbox", createdAt: "2026-07-21T09:00:00Z" });
    const scheduled = makeTask({ lifecycle: "active", priorityBucket: "schedule" });
    const doNow = makeTask({ lifecycle: "active", priorityBucket: "do_now" });
    const staleWaiting = makeTask({ lifecycle: "waiting", updatedAt: "2026-07-19T09:00:00Z" });
    const freshWaiting = makeTask({ lifecycle: "waiting", updatedAt: "2026-07-21T09:00:00Z" });
    const someday = makeTask({ lifecycle: "someday" });
    const doneEarlier = makeTask({ lifecycle: "done", completedAt: "2026-07-18T09:00:00Z" });
    const doneLater = makeTask({ lifecycle: "done", completedAt: "2026-07-21T09:00:00Z" });
    const dropped = makeTask({ lifecycle: "dropped" });
    const tasks = [
      olderInbox,
      scheduled,
      staleWaiting,
      doneEarlier,
      dropped,
      newerInbox,
      doNow,
      freshWaiting,
      someday,
      doneLater,
    ];

    const board = Object.fromEntries(
      selectBoardColumns(tasks).map((c) => [c.status, ids(c.tasks)]),
    );

    expect(board).toEqual({
      inbox: [newerInbox.id, olderInbox.id],
      active: [doNow.id, scheduled.id],
      waiting: [freshWaiting.id, staleWaiting.id],
      someday: [someday.id],
      done: [doneLater.id, doneEarlier.id],
      dropped: [dropped.id],
    });
    // A column is exactly its list page, so toggling views never reshuffles.
    expect(board.inbox).toEqual(ids(selectInboxTasks(tasks)));
    expect(board.active).toEqual(ids(selectFocusTasks(tasks)));
    expect(board.waiting).toEqual(ids(selectByLifecycle(tasks, "waiting")));
    expect(board.done).toEqual(ids(selectDoneTasks(tasks)));
    expect(board.dropped).toEqual(ids(selectDroppedTasks(tasks)));
    expect(Object.values(board).flat().sort()).toEqual(ids(tasks).sort());
  });
});
