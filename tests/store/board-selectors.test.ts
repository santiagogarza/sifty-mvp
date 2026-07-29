import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  selectBoardColumns,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/**
 * Board grouping contract: exactly the five STATUS_VIEWS columns in
 * pipeline order, always all five even when empty, `dropped` never
 * appears, per-column sort matches the equivalent list view, and the
 * common filters narrow every column.
 */

const NOW = new Date("2026-07-22T12:00:00Z");

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

describe("selectBoardColumns", () => {
  it("returns exactly the five STATUS_VIEWS statuses in pipeline order", () => {
    const columns = selectBoardColumns([]);
    expect(columns.map((c) => c.status)).toEqual(["inbox", "active", "waiting", "someday", "done"]);
    expect(columns.map((c) => c.status)).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(columns.map((c) => c.label)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
  });

  it("always returns five columns, even when every column is empty", () => {
    expect(selectBoardColumns([])).toHaveLength(5);
    const onlyFocus = [makeTask({ lifecycle: "active" })];
    const columns = selectBoardColumns(onlyFocus);
    expect(columns).toHaveLength(5);
    expect(columns.filter((c) => c.tasks.length === 0)).toHaveLength(4);
  });

  it("never surfaces dropped tasks in any column", () => {
    const dropped = makeTask({ lifecycle: "dropped" });
    const columns = selectBoardColumns([dropped, makeTask({ lifecycle: "inbox" })]);
    for (const column of columns) {
      expect(column.tasks.map((t) => t.id)).not.toContain(dropped.id);
    }
    expect(columns.reduce((n, c) => n + c.tasks.length, 0)).toBe(1);
  });

  it("groups every task under its own lifecycle", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
    ];
    const columns = selectBoardColumns(tasks);
    for (const column of columns) {
      expect(column.tasks).toHaveLength(1);
      expect(column.tasks[0]!.lifecycle).toBe(column.status);
    }
  });

  it("sorts each column exactly like the equivalent list view", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-20T00:00:00Z" }),
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-22T00:00:00Z" }),
      makeTask({ lifecycle: "active", urgency: 0.9, importance: 0.9, priorityBucket: "do_now" }),
      makeTask({ lifecycle: "active", urgency: 0.1, importance: 0.1, priorityBucket: "drop" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-19T00:00:00Z" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-21T00:00:00Z" }),
    ];
    const byStatus = new Map(selectBoardColumns(tasks).map((c) => [c.status, c.tasks]));
    expect(byStatus.get("inbox")!.map((t) => t.id)).toEqual(
      selectInboxTasks(tasks).map((t) => t.id),
    );
    expect(byStatus.get("active")!.map((t) => t.id)).toEqual(
      selectFocusTasks(tasks).map((t) => t.id),
    );
    expect(byStatus.get("done")!.map((t) => t.id)).toEqual(selectDoneTasks(tasks).map((t) => t.id));
  });

  it("narrows every column through the shared search and label filters", () => {
    const label = "label_urgent";
    const tasks = [
      makeTask({ lifecycle: "inbox", title: "Renew passport" }),
      makeTask({ lifecycle: "inbox", title: "Email Priya" }),
      makeTask({ lifecycle: "active", title: "Renew gym membership", labelIds: [label] }),
      makeTask({ lifecycle: "done", title: "Renew domain", completedAt: NOW.toISOString() }),
    ];

    const searched = selectBoardColumns(tasks, { search: "renew" });
    expect(searched.map((c) => c.tasks.length)).toEqual([1, 1, 0, 0, 1]);

    const labeled = selectBoardColumns(tasks, { labelId: label });
    expect(labeled.map((c) => c.tasks.length)).toEqual([0, 1, 0, 0, 0]);
  });
});
