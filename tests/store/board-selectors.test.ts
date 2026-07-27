import type { Task } from "@/lib/domain/types";
import {
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `board_task_${seq}`,
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

describe("selectBoardColumns", () => {
  it("returns exactly the five routed statuses, even when empty", () => {
    const columns = selectBoardColumns([]);
    expect(columns.map((column) => column.view.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ]);
    expect(columns.every((column) => column.tasks.length === 0)).toBe(true);
  });

  it("excludes dropped tasks and keeps each column sorted like its list view", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-20T00:00:00.000Z" }),
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-21T00:00:00.000Z" }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now", urgency: 1, importance: 1 }),
      makeTask({ lifecycle: "active", priorityBucket: "schedule", urgency: 0.2, importance: 0.9 }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-20T00:00:00.000Z" }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-22T00:00:00.000Z" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-19T00:00:00.000Z" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-22T00:00:00.000Z" }),
      makeTask({ lifecycle: "dropped" }),
    ];
    const columns = selectBoardColumns(tasks);
    expect(columns.flatMap((column) => column.tasks.map((task) => task.lifecycle))).not.toContain(
      "dropped",
    );
    expect(columns[0].tasks.map((task) => task.id)).toEqual(
      selectInboxTasks(tasks).map((task) => task.id),
    );
    expect(columns[1].tasks.map((task) => task.id)).toEqual(
      selectFocusTasks(tasks).map((task) => task.id),
    );
    expect(columns[2].tasks.map((task) => task.id)).toEqual(
      selectByLifecycle(tasks, "waiting").map((task) => task.id),
    );
    expect(columns[4].tasks.map((task) => task.id)).toEqual(
      selectDoneTasks(tasks).map((task) => task.id),
    );
  });

  it("applies search and label filters to every column", () => {
    const labelId = "label_cursor";
    const kept = makeTask({ lifecycle: "active", title: "Cursor follow-up", labelIds: [labelId] });
    const wrongLabel = makeTask({ lifecycle: "active", title: "Cursor other", labelIds: [] });
    const wrongSearch = makeTask({
      lifecycle: "waiting",
      title: "Email finance",
      labelIds: [labelId],
    });

    const columns = selectBoardColumns([kept, wrongLabel, wrongSearch], {
      labelId,
      search: "cursor",
    });
    expect(columns.flatMap((column) => column.tasks.map((task) => task.id))).toEqual([kept.id]);
  });
});
