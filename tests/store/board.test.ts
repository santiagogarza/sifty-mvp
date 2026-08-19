import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import { LIFECYCLE, type Task } from "@/lib/domain/types";
import {
  DEFAULT_BOARD_LENS,
  TODAY_BOARD_LENS,
  adjacentColumn,
  partitionByLifecycle,
  resolveDrop,
} from "@/lib/store/board";
import {
  isTodayTask,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";
import { makeTask } from "../helpers/tasks";

/**
 * Board contract: columns are exactly the stored lifecycle values, filters
 * and per-column order are the same functions the list views use, and a
 * drop resolves to the same mutation the Status picker makes.
 */

const NOW = new Date("2026-07-22T12:00:00Z");

function iso(daysFromNow: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
}

describe("partitionByLifecycle", () => {
  it("places every task in exactly the column matching its stored lifecycle", () => {
    const tasks = LIFECYCLE.flatMap((lifecycle) => [
      makeTask({ lifecycle }),
      makeTask({ lifecycle }),
    ]);
    const partition = partitionByLifecycle(tasks, {}, STATUSES_IN_ORDER, NOW);

    for (const lifecycle of LIFECYCLE) {
      expect(partition[lifecycle]).toHaveLength(2);
      for (const task of partition[lifecycle]) {
        expect(task.lifecycle).toBe(lifecycle);
      }
    }
    const placed = Object.values(partition).flat();
    expect(placed).toHaveLength(tasks.length);
    expect(new Set(placed.map((t) => t.id)).size).toBe(tasks.length);
  });

  it("excludes tasks whose lifecycle is not in the requested columns", () => {
    const tasks = [makeTask({ lifecycle: "inbox" }), makeTask({ lifecycle: "someday" })];
    const partition = partitionByLifecycle(tasks, {}, ["inbox", "active"], NOW);
    expect(partition.inbox).toHaveLength(1);
    expect(partition.someday).toHaveLength(0);
  });

  it("applies label and search filters identically to the list selectors", () => {
    const tasks: Task[] = [
      makeTask({ lifecycle: "inbox", labelIds: ["label_a"], createdAt: at(1) }),
      makeTask({ lifecycle: "inbox", labelIds: ["label_b"], createdAt: at(2) }),
      makeTask({ lifecycle: "inbox", title: "Renew passport", createdAt: at(3) }),
      makeTask({ lifecycle: "active", labelIds: ["label_a"], importance: 0.9, urgency: 0.9 }),
      makeTask({ lifecycle: "active", title: "Passport photos", due: iso(1) }),
      makeTask({ lifecycle: "waiting", labelIds: ["label_a"], updatedAt: at(5) }),
      makeTask({ lifecycle: "done", labelIds: ["label_a"], completedAt: at(4) }),
      makeTask({ lifecycle: "done", completedAt: at(1) }),
    ];

    for (const args of [{ labelId: "label_a" }, { search: "passport" }, {}]) {
      const partition = partitionByLifecycle(tasks, args, STATUSES_IN_ORDER, NOW);
      expect(partition.inbox).toEqual(selectInboxTasks(tasks, args));
      expect(partition.active).toEqual(selectFocusTasks(tasks, args));
      expect(partition.waiting).toEqual(selectByLifecycle(tasks, "waiting", args));
      expect(partition.done).toEqual(selectDoneTasks(tasks, args));
    }
  });

  it("orders columns exactly like the matching list views", () => {
    const older = makeTask({ lifecycle: "inbox", createdAt: at(10) });
    const newer = makeTask({ lifecycle: "inbox", createdAt: at(1) });
    const doneOld = makeTask({ lifecycle: "done", completedAt: at(9) });
    const doneNew = makeTask({ lifecycle: "done", completedAt: at(2) });
    const partition = partitionByLifecycle(
      [older, doneOld, newer, doneNew],
      {},
      STATUSES_IN_ORDER,
      NOW,
    );
    expect(partition.inbox.map((t) => t.id)).toEqual([newer.id, older.id]);
    expect(partition.done.map((t) => t.id)).toEqual([doneNew.id, doneOld.id]);
  });

  it("keeps the Today lens: only isTodayTask members, never someday/done/dropped", () => {
    const tasks: Task[] = [
      makeTask({ lifecycle: "inbox", due: iso(-1) }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "active", due: iso(4), priorityBucket: "schedule" }),
      makeTask({ lifecycle: "waiting", due: iso(0) }),
      makeTask({ lifecycle: "waiting" }),
      // Even with forcing dates, these lifecycles never surface on Today.
      makeTask({ lifecycle: "someday", due: iso(-2), priorityBucket: "do_now" }),
      makeTask({ lifecycle: "done", due: iso(0) }),
      makeTask({ lifecycle: "dropped", due: iso(-3) }),
    ];
    const partition = partitionByLifecycle(
      tasks,
      { filter: TODAY_BOARD_LENS.filter },
      TODAY_BOARD_LENS.columns,
      NOW,
    );

    const surfaced = Object.values(partition).flat();
    expect(surfaced.length).toBeGreaterThan(0);
    for (const task of surfaced) {
      expect(isTodayTask(task, NOW)).toBe(true);
    }
    expect(partition.someday).toHaveLength(0);
    expect(partition.done).toHaveLength(0);
    expect(partition.dropped).toHaveLength(0);
    expect(TODAY_BOARD_LENS.columns).toEqual(["inbox", "active", "waiting"]);
  });
});

describe("resolveDrop", () => {
  const focusTask = makeTask({ lifecycle: "active" });
  const tasks = [focusTask, makeTask({ lifecycle: "inbox" })];

  it("resolves a cross-column drop to the Status picker's mutation", () => {
    expect(resolveDrop(tasks, focusTask.id, "done")).toEqual({
      taskId: focusTask.id,
      lifecycle: "done",
    });
  });

  it("is a no-op when the card is dropped in its own column", () => {
    expect(resolveDrop(tasks, focusTask.id, "active")).toBeNull();
  });

  it("is a no-op without a target, with an unknown target, or an unknown task", () => {
    expect(resolveDrop(tasks, focusTask.id, null)).toBeNull();
    expect(resolveDrop(tasks, focusTask.id, "not-a-status")).toBeNull();
    expect(resolveDrop(tasks, "task_missing", "done")).toBeNull();
  });
});

describe("adjacentColumn", () => {
  const columns = DEFAULT_BOARD_LENS.columns;

  it("steps one visible column in either direction", () => {
    expect(adjacentColumn(columns, "active", 1)).toBe("waiting");
    expect(adjacentColumn(columns, "active", -1)).toBe("inbox");
  });

  it("is null at either end and for a column outside the set", () => {
    expect(adjacentColumn(columns, "inbox", -1)).toBeNull();
    expect(adjacentColumn(columns, "done", 1)).toBeNull();
    expect(adjacentColumn(columns, "dropped", 1)).toBeNull();
  });
});
