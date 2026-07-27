import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { selectBoardColumns, selectFocusTasks, selectInboxTasks } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

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
  it("returns exactly five STATUS_VIEWS columns in pipeline order", () => {
    const columns = selectBoardColumns([]);
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.status)).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(columns.map((c) => c.label)).toEqual(STATUS_VIEWS.map((v) => v.label));
  });

  it("always returns five columns even when empty", () => {
    const columns = selectBoardColumns([]);
    for (const col of columns) {
      expect(col.tasks).toEqual([]);
    }
  });

  it("never includes dropped tasks", () => {
    const dropped = makeTask({ lifecycle: "dropped", title: "Dropped task" });
    const columns = selectBoardColumns([dropped]);
    const allIds = columns.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds).not.toContain(dropped.id);
    expect(columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it("per-column sort matches the equivalent list view", () => {
    const inboxOld = makeTask({
      lifecycle: "inbox",
      title: "Older inbox",
      createdAt: "2026-07-20T12:00:00Z",
    });
    const inboxNew = makeTask({
      lifecycle: "inbox",
      title: "Newer inbox",
      createdAt: "2026-07-21T12:00:00Z",
    });
    const focus = makeTask({ lifecycle: "active", title: "Focus task", priorityBucket: "do_now" });
    const tasks = [inboxOld, inboxNew, focus];

    const columns = selectBoardColumns(tasks);
    const inboxCol = columns.find((c) => c.status === "inbox");
    expect(inboxCol?.tasks.map((t) => t.id)).toEqual(selectInboxTasks(tasks).map((t) => t.id));
    const focusCol = columns.find((c) => c.status === "active");
    expect(focusCol?.tasks.map((t) => t.id)).toEqual(selectFocusTasks(tasks).map((t) => t.id));
  });

  it("search and labelId args narrow every column", () => {
    const labelId = "lbl_1";
    const match = makeTask({ lifecycle: "inbox", title: "Find me alpha", labelIds: [labelId] });
    const otherInbox = makeTask({ lifecycle: "inbox", title: "Other" });
    const focusMatch = makeTask({ lifecycle: "active", title: "Find me beta" });
    const tasks = [match, otherInbox, focusMatch];

    const columns = selectBoardColumns(tasks, { search: "find me" });
    expect(columns.flatMap((c) => c.tasks)).toHaveLength(2);

    const labeled = selectBoardColumns(tasks, { labelId });
    expect(labeled.flatMap((c) => c.tasks)).toHaveLength(1);
    expect(labeled.find((c) => c.status === "inbox")?.tasks[0]?.id).toBe(match.id);
  });
});
