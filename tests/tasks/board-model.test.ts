import { BOARD_COLUMNS, boardDropTarget, tasksForColumn } from "@/components/tasks/board-model";
import type { Task } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task>): Task {
  return {
    id: patch.id ?? "task_board",
    sourceText: "test",
    sourceContext: null,
    title: patch.title ?? "Task",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.2,
    importance: 0.2,
    priorityBucket: "unset",
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

describe("board columns", () => {
  it("follows STATUS_VIEWS and omits Dropped and Today", () => {
    expect(BOARD_COLUMNS.map((column) => column.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ]);
    expect(BOARD_COLUMNS.map((column) => column.label)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
    expect(BOARD_COLUMNS.some((column) => column.status === "dropped")).toBe(false);
  });

  it("keeps each column in that list's sort", () => {
    const tasks = [
      makeTask({ id: "in-old", lifecycle: "inbox", createdAt: "2026-07-20T00:00:00.000Z" }),
      makeTask({ id: "in-new", lifecycle: "inbox", createdAt: "2026-07-22T00:00:00.000Z" }),
      makeTask({
        id: "focus-low",
        lifecycle: "active",
        priorityBucket: "drop",
        urgency: 0.1,
        importance: 0.1,
      }),
      makeTask({
        id: "focus-high",
        lifecycle: "active",
        priorityBucket: "do_now",
        urgency: 0.9,
        importance: 0.9,
      }),
      makeTask({
        id: "done-old",
        lifecycle: "done",
        completedAt: "2026-07-20T00:00:00.000Z",
      }),
      makeTask({
        id: "done-new",
        lifecycle: "done",
        completedAt: "2026-07-22T00:00:00.000Z",
      }),
      makeTask({ id: "gone", lifecycle: "dropped" }),
    ];

    expect(tasksForColumn(tasks, "inbox").map((task) => task.id)).toEqual(["in-new", "in-old"]);
    expect(tasksForColumn(tasks, "active").map((task) => task.id)).toEqual([
      "focus-high",
      "focus-low",
    ]);
    expect(tasksForColumn(tasks, "done").map((task) => task.id)).toEqual(["done-new", "done-old"]);
    expect(tasksForColumn(tasks, "dropped")).toEqual([]);
  });
});

describe("boardDropTarget", () => {
  it("ignores a same-column drop, a miss, and Dropped", () => {
    expect(boardDropTarget("inbox", "inbox")).toBeNull();
    expect(boardDropTarget("inbox", null)).toBeNull();
    expect(boardDropTarget("active", "dropped")).toBeNull();
    expect(boardDropTarget("inbox", "today")).toBeNull();
  });

  it("accepts any other board column", () => {
    expect(boardDropTarget("inbox", "done")).toBe("done");
    expect(boardDropTarget("done", "someday")).toBe("someday");
  });
});
