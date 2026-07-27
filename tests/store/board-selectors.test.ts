import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  selectBoardColumns,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/**
 * The board's column contract: the same five views the sidebar has, in
 * the same order, each holding exactly what its list holds. A column that
 * sorted or filtered differently from its list would make the board a
 * second, quietly disagreeing source of truth.
 */

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const stamp = new Date(NOW.getTime() + seq * 60_000).toISOString();
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
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    ...patch,
  };
}

describe("selectBoardColumns", () => {
  it("is the five status views, in pipeline order, even with nothing to show", () => {
    const columns = selectBoardColumns([]);
    expect(columns.map((c) => c.status)).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(columns.map((c) => c.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ] satisfies Lifecycle[]);
    expect(columns.map((c) => c.label)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
    expect(columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it("never surfaces a dropped task — dropped has no view, so it has no column", () => {
    const dropped = makeTask({ lifecycle: "dropped" });
    const columns = selectBoardColumns([dropped, makeTask({ lifecycle: "inbox" })]);
    expect(columns.flatMap((c) => c.tasks).map((t) => t.id)).not.toContain(dropped.id);
    expect(columns.flatMap((c) => c.tasks)).toHaveLength(1);
  });

  it("routes each task to exactly one column, by its stored status", () => {
    const tasks: Task[] = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
    ];
    expect(selectBoardColumns(tasks).map((c) => c.tasks.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it("sorts every column exactly as its list view does", () => {
    const tasks: Task[] = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", priorityBucket: "drop" }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
      makeTask({
        lifecycle: "done",
        completedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
      }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
    ];
    const columns = selectBoardColumns(tasks);
    const ids = (list: Task[]) => list.map((t) => t.id);

    expect(ids(columns[0]!.tasks)).toEqual(ids(selectInboxTasks(tasks)));
    expect(ids(columns[1]!.tasks)).toEqual(ids(selectFocusTasks(tasks)));
    expect(ids(columns[4]!.tasks)).toEqual(ids(selectDoneTasks(tasks)));

    // Not a tautology: the three sorts really are different rules.
    expect(ids(columns[0]!.tasks)).not.toEqual(ids(tasks.filter((t) => t.lifecycle === "inbox")));
  });

  it("narrows every column by search and by label", () => {
    const tasks: Task[] = [
      makeTask({ lifecycle: "inbox", title: "Renew passport", labelIds: ["label_travel"] }),
      makeTask({ lifecycle: "inbox", title: "Pay invoice" }),
      makeTask({ lifecycle: "active", title: "Book passport photo", labelIds: ["label_travel"] }),
      makeTask({ lifecycle: "waiting", title: "Pay invoice again" }),
    ];

    const searched = selectBoardColumns(tasks, { search: "passport" });
    expect(searched.flatMap((c) => c.tasks.map((t) => t.title))).toEqual([
      "Renew passport",
      "Book passport photo",
    ]);

    const labelled = selectBoardColumns(tasks, { labelId: "label_travel" });
    expect(labelled.map((c) => c.tasks.length)).toEqual([1, 1, 0, 0, 0]);

    // Columns still exist when a filter empties them — a board that grew
    // and shrank its column set while typing would be unreadable.
    expect(selectBoardColumns(tasks, { search: "nothing matches" })).toHaveLength(5);
  });
});
