import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  BOARD_STATUSES,
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/**
 * Board contract: the columns are the statuses that have a view, in the
 * sidebar's order, and each column lists its tasks exactly as that status's
 * own list view does — switching List ⇄ Board never reshuffles anything.
 */

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const at = new Date(Date.UTC(2026, 6, 1, 9, seq)).toISOString();
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
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    ...patch,
  };
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("selectBoardColumns", () => {
  it("has one column per status view, in pipeline order, and none for dropped", () => {
    expect(BOARD_STATUSES).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(BOARD_STATUSES).toEqual(["inbox", "active", "waiting", "someday", "done"]);
    expect(selectBoardColumns([]).map((c) => c.status)).toEqual(BOARD_STATUSES);

    const dropped = makeTask({ lifecycle: "dropped" });
    const columns = selectBoardColumns([dropped]);
    expect(columns.flatMap((c) => c.tasks)).toEqual([]);
  });

  it("orders every column exactly like that status's list view", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", priorityBucket: "drop", urgency: 0.1, importance: 0.1 }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now", urgency: 0.9, importance: 0.9 }),
      makeTask({ lifecycle: "active", due: "2026-07-02" }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-03T00:00:00.000Z" }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-05T00:00:00.000Z" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-04T00:00:00.000Z" }),
      makeTask({ lifecycle: "done", completedAt: "2026-07-06T00:00:00.000Z" }),
    ];
    const byStatus = Object.fromEntries(
      selectBoardColumns(tasks).map((c) => [c.status, ids(c.tasks)]),
    );

    expect(byStatus.inbox).toEqual(ids(selectInboxTasks(tasks)));
    expect(byStatus.active).toEqual(ids(selectFocusTasks(tasks)));
    expect(byStatus.waiting).toEqual(ids(selectByLifecycle(tasks, "waiting")));
    expect(byStatus.someday).toEqual(ids(selectByLifecycle(tasks, "someday")));
    expect(byStatus.done).toEqual(ids(selectDoneTasks(tasks)));
    // Sanity: the sorts are real, not insertion order.
    expect(byStatus.done).toEqual([tasks[9]!.id, tasks[8]!.id]);
    expect(byStatus.waiting).toEqual([tasks[6]!.id, tasks[5]!.id]);
  });

  it("applies the shared label and search filters to every column", () => {
    const tagged = makeTask({ lifecycle: "active", labelIds: ["label_work"], title: "Ship it" });
    const tasks = [tagged, makeTask({ lifecycle: "active" }), makeTask({ lifecycle: "done" })];

    const byLabel = selectBoardColumns(tasks, { labelId: "label_work" });
    expect(byLabel.flatMap((c) => ids(c.tasks))).toEqual([tagged.id]);

    const bySearch = selectBoardColumns(tasks, { search: "ship" });
    expect(bySearch.flatMap((c) => ids(c.tasks))).toEqual([tagged.id]);
  });
});
