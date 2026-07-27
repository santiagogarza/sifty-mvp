import type { Task } from "@/lib/domain/types";
import {
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

let sequence = 0;
function task(patch: Partial<Task> = {}): Task {
  sequence += 1;
  const timestamp = new Date(2026, 0, sequence).toISOString();
  return {
    id: `board-${sequence}`,
    sourceText: "source",
    sourceContext: null,
    title: `Task ${sequence}`,
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
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    ...patch,
  };
}

describe("selectBoardColumns", () => {
  it("always returns the five routed statuses and excludes dropped", () => {
    const dropped = task({ lifecycle: "dropped" });
    const columns = selectBoardColumns([dropped]);

    expect(columns.map((column) => column.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ]);
    expect(columns.every((column) => column.tasks.length === 0)).toBe(true);
  });

  it("uses the same sort contract as each list view", () => {
    const tasks = [
      task({ lifecycle: "inbox" }),
      task({ lifecycle: "inbox" }),
      task({ lifecycle: "active", priorityBucket: "do_now" }),
      task({ lifecycle: "active", priorityBucket: "schedule" }),
      task({ lifecycle: "waiting" }),
      task({ lifecycle: "waiting" }),
      task({ lifecycle: "someday" }),
      task({ lifecycle: "done", completedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    const byStatus = new Map(
      selectBoardColumns(tasks).map((column) => [
        column.status,
        column.tasks.map((item) => item.id),
      ]),
    );

    expect(byStatus.get("inbox")).toEqual(selectInboxTasks(tasks).map((item) => item.id));
    expect(byStatus.get("active")).toEqual(selectFocusTasks(tasks).map((item) => item.id));
    expect(byStatus.get("waiting")).toEqual(
      selectByLifecycle(tasks, "waiting").map((item) => item.id),
    );
    expect(byStatus.get("someday")).toEqual(
      selectByLifecycle(tasks, "someday").map((item) => item.id),
    );
    expect(byStatus.get("done")).toEqual(selectDoneTasks(tasks).map((item) => item.id));
  });

  it("applies search and label filters to every column", () => {
    const matching = task({ title: "Quarterly brief", labelIds: ["work"], lifecycle: "waiting" });
    const tasks = [
      matching,
      task({ title: "Quarterly brief", lifecycle: "active" }),
      task({ title: "Personal", labelIds: ["work"], lifecycle: "done" }),
    ];

    const columns = selectBoardColumns(tasks, { search: "quarterly", labelId: "work" });
    expect(columns.flatMap((column) => column.tasks)).toEqual([matching]);
  });
});
