import type { Lifecycle, Task } from "@/lib/domain/types";
import { selectBoardColumns, selectInboxTasks } from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";

/**
 * Board read-model contract. A type checker can prove the shape; these prove
 * the invariants — five columns, always, in pipeline order, `dropped` never
 * shown, per-column order matching the list, and filters that reach every
 * column.
 */

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_${seq}`,
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
    expect(columns.map((c) => c.status)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ] satisfies Lifecycle[]);
  });

  it("is always five columns, even with no tasks", () => {
    const columns = selectBoardColumns([]);
    expect(columns).toHaveLength(5);
    for (const column of columns) expect(column.tasks).toEqual([]);
  });

  it("never surfaces dropped tasks in any column", () => {
    const tasks = [
      makeTask({ lifecycle: "dropped" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
    ];
    const columns = selectBoardColumns(tasks);
    const shown = columns.flatMap((c) => c.tasks);
    expect(shown).toHaveLength(2);
    expect(shown.some((t) => t.lifecycle === "dropped")).toBe(false);
  });

  it("files each task into the column that matches its lifecycle", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active" }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: NOW.toISOString() }),
    ];
    const byStatus = Object.fromEntries(selectBoardColumns(tasks).map((c) => [c.status, c.tasks]));
    expect(byStatus.inbox).toHaveLength(1);
    expect(byStatus.active).toHaveLength(1);
    expect(byStatus.waiting).toHaveLength(1);
    expect(byStatus.someday).toHaveLength(1);
    expect(byStatus.done).toHaveLength(1);
  });

  it("orders each column exactly like the equivalent list view", () => {
    const older = makeTask({ lifecycle: "inbox", createdAt: "2026-07-20T09:00:00Z" });
    const newer = makeTask({ lifecycle: "inbox", createdAt: "2026-07-21T09:00:00Z" });
    const tasks = [older, newer];
    const inboxColumn = selectBoardColumns(tasks).find((c) => c.status === "inbox");
    expect(inboxColumn?.tasks.map((t) => t.id)).toEqual(selectInboxTasks(tasks).map((t) => t.id));
    // Inbox is newest-first.
    expect(inboxColumn?.tasks[0]?.id).toBe(newer.id);
  });

  it("narrows every column by search and labelId", () => {
    const match = makeTask({ lifecycle: "active", title: "Alpha report", labelIds: ["l1"] });
    const noText = makeTask({ lifecycle: "active", title: "Beta memo", labelIds: ["l1"] });
    const noLabel = makeTask({ lifecycle: "inbox", title: "Alpha draft", labelIds: [] });
    const tasks = [match, noText, noLabel];

    const searched = selectBoardColumns(tasks, { search: "alpha" }).flatMap((c) => c.tasks);
    expect(searched.map((t) => t.id).sort()).toEqual([match.id, noLabel.id].sort());

    const labeled = selectBoardColumns(tasks, { labelId: "l1" }).flatMap((c) => c.tasks);
    expect(labeled.map((t) => t.id).sort()).toEqual([match.id, noText.id].sort());
  });
});
