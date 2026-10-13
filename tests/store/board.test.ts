import type { Task } from "@/lib/domain/types";
import {
  DEFAULT_BOARD_COLUMNS,
  TODAY_BOARD_COLUMNS,
  isTodayTask,
  partitionByLifecycle,
  wouldRemainOnBoard,
} from "@/lib/store/board";
import { selectFocusTasks } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

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
    id: `task_board_${seq}`,
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

describe("partitionByLifecycle", () => {
  it("places every task in the column matching its lifecycle", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
      makeTask({ lifecycle: "dropped" }),
    ];

    const partitioned = partitionByLifecycle(tasks, {}, DEFAULT_BOARD_COLUMNS, NOW);

    expect(partitioned.inbox).toHaveLength(1);
    expect(partitioned.active).toHaveLength(1);
    expect(partitioned.waiting).toHaveLength(1);
    expect(partitioned.someday).toHaveLength(1);
    expect(partitioned.done).toHaveLength(1);
    expect(partitioned.dropped).toHaveLength(0);

    const allPlaced = [
      ...partitioned.inbox,
      ...partitioned.active,
      ...partitioned.waiting,
      ...partitioned.someday,
      ...partitioned.done,
    ];
    expect(allPlaced).toHaveLength(tasks.length - 1);
    for (const task of tasks.filter((t) => t.lifecycle !== "dropped")) {
      expect(allPlaced.find((p) => p.id === task.id)?.lifecycle).toBe(task.lifecycle);
    }
  });

  it("applies label and search filters identically to list selectors", () => {
    const labelId = "label_a";
    const tasks = [
      makeTask({ title: "Alpha report", labelIds: [labelId] }),
      makeTask({ title: "Beta notes", labelIds: [labelId] }),
      makeTask({ title: "Gamma plan", labelIds: [] }),
    ];

    const byLabel = partitionByLifecycle(tasks, { labelId }, DEFAULT_BOARD_COLUMNS, NOW);
    const labelCount = DEFAULT_BOARD_COLUMNS.reduce((n, col) => n + byLabel[col].length, 0);
    expect(labelCount).toBe(2);

    const bySearch = partitionByLifecycle(tasks, { search: "beta" }, DEFAULT_BOARD_COLUMNS, NOW);
    const searchCount = DEFAULT_BOARD_COLUMNS.reduce((n, col) => n + bySearch[col].length, 0);
    expect(searchCount).toBe(1);
    expect(bySearch.inbox[0]?.title).toBe("Beta notes");
  });

  it("Today board partition contains only isTodayTask tasks in inbox/active/waiting", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", due: iso(-1) }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "waiting", due: iso(0) }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "someday", due: iso(-1) }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
      makeTask({ lifecycle: "dropped" }),
    ];

    const partitioned = partitionByLifecycle(
      tasks,
      { taskFilter: isTodayTask },
      TODAY_BOARD_COLUMNS,
      NOW,
    );

    const placed = [...partitioned.inbox, ...partitioned.active, ...partitioned.waiting];
    expect(placed).toHaveLength(3);
    for (const task of placed) {
      expect(isTodayTask(task, NOW)).toBe(true);
      expect(["inbox", "active", "waiting"]).toContain(task.lifecycle);
    }
    expect(partitioned.someday).toHaveLength(0);
    expect(partitioned.done).toHaveLength(0);
    expect(partitioned.dropped).toHaveLength(0);
  });

  it("Focus column sorts by focusScore ascending, matching the Focus list", () => {
    const high = makeTask({
      lifecycle: "active",
      priorityBucket: "do_now",
      importance: 0.9,
      urgency: 0.9,
    });
    const mid = makeTask({
      lifecycle: "active",
      priorityBucket: "schedule",
      importance: 0.6,
      urgency: 0.3,
    });
    const low = makeTask({
      lifecycle: "active",
      priorityBucket: "drop",
      importance: 0.1,
      urgency: 0.1,
    });
    const partitioned = partitionByLifecycle([low, high, mid], {}, DEFAULT_BOARD_COLUMNS, NOW);
    expect(partitioned.active.map((t) => t.id)).toEqual([high.id, mid.id, low.id]);
    expect(partitioned.active.map((t) => t.id)).toEqual(
      selectFocusTasks([low, high, mid]).map((t) => t.id),
    );
  });
});

describe("wouldRemainOnBoard", () => {
  it("rejects a due-less do_now move into waiting under the Today filter", () => {
    const task = makeTask({ lifecycle: "active", priorityBucket: "do_now" });
    expect(wouldRemainOnBoard(task, "waiting", TODAY_BOARD_COLUMNS, isTodayTask, NOW)).toBe(false);
    expect(wouldRemainOnBoard(task, "inbox", TODAY_BOARD_COLUMNS, isTodayTask, NOW)).toBe(true);
  });

  it("allows a due-today task to enter waiting on Today", () => {
    const task = makeTask({ lifecycle: "active", due: iso(0), priorityBucket: "do_now" });
    expect(wouldRemainOnBoard(task, "waiting", TODAY_BOARD_COLUMNS, isTodayTask, NOW)).toBe(true);
  });

  it("rejects a move into done when Done is not a visible column", () => {
    const task = makeTask({ lifecycle: "active", priorityBucket: "do_now" });
    expect(wouldRemainOnBoard(task, "done", TODAY_BOARD_COLUMNS, isTodayTask, NOW)).toBe(false);
  });
});
