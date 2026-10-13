import { STATUSES_IN_ORDER, STATUS_META } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import {
  BOARD_LIFECYCLES,
  selectBoardColumns,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
  selectTodayTasks,
} from "@/lib/store/selectors";
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
  const created = new Date(NOW.getTime() - seq * 1000).toISOString();
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
    createdAt: created,
    updatedAt: created,
    completedAt: null,
    ...patch,
  };
}

describe("BOARD_LIFECYCLES", () => {
  it("is the statuses that have a view, in pipeline order", () => {
    expect([...BOARD_LIFECYCLES]).toEqual(
      STATUSES_IN_ORDER.filter((status) => STATUS_META[status].href !== null),
    );
    expect(BOARD_LIFECYCLES).not.toContain("dropped");
  });
});

describe("selectBoardColumns", () => {
  it("keeps each column's list sort and leaves dropped off the board", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-01T00:00:00.000Z" }),
      makeTask({ lifecycle: "inbox", createdAt: "2026-07-03T00:00:00.000Z" }),
      makeTask({ lifecycle: "active", priorityBucket: "schedule", importance: 0.9 }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now", importance: 0.2 }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-01T00:00:00.000Z" }),
      makeTask({ lifecycle: "waiting", updatedAt: "2026-07-04T00:00:00.000Z" }),
      makeTask({ lifecycle: "someday", updatedAt: "2026-07-02T00:00:00.000Z" }),
      makeTask({
        lifecycle: "done",
        completedAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
      makeTask({
        lifecycle: "done",
        completedAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      }),
      makeTask({ lifecycle: "dropped", title: "gone" }),
    ];

    const columns = selectBoardColumns(tasks, {}, NOW);
    const ids = (lifecycle: (typeof BOARD_LIFECYCLES)[number]) =>
      columns.find((column) => column.lifecycle === lifecycle)!.tasks.map((task) => task.id);

    expect(ids("inbox")).toEqual(selectInboxTasks(tasks).map((task) => task.id));
    expect(ids("active")).toEqual(selectFocusTasks(tasks).map((task) => task.id));
    expect(ids("waiting")).toEqual(selectByLifecycle(tasks, "waiting").map((task) => task.id));
    expect(ids("someday")).toEqual(selectByLifecycle(tasks, "someday").map((task) => task.id));
    expect(ids("done")).toEqual(selectDoneTasks(tasks).map((task) => task.id));
    expect(columns.reduce((sum, column) => sum + column.tasks.length, 0)).toBe(tasks.length - 1);
    expect(
      columns.flatMap((column) => column.tasks).some((task) => task.lifecycle === "dropped"),
    ).toBe(false);
  });

  it("applies search and label filters", () => {
    const tasks = [
      makeTask({ title: "Write the brief", labelIds: ["label_work"] }),
      makeTask({ title: "Walk the dog", lifecycle: "active", labelIds: ["label_home"] }),
      makeTask({ title: "Brief the team", lifecycle: "waiting", labelIds: ["label_work"] }),
    ];
    const searched = selectBoardColumns(tasks, { search: "brief" });
    expect(searched.flatMap((column) => column.tasks.map((task) => task.title)).sort()).toEqual([
      "Brief the team",
      "Write the brief",
    ]);
    const labeled = selectBoardColumns(tasks, { labelId: "label_work" });
    expect(labeled.reduce((sum, column) => sum + column.tasks.length, 0)).toBe(2);
  });

  it("partitions the Today lens by real lifecycle and leaves Someday and Done empty", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", priorityBucket: "do_now" }),
      makeTask({ lifecycle: "inbox" }),
      makeTask({ lifecycle: "active", due: iso(0) }),
      makeTask({ lifecycle: "waiting", due: iso(-1) }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday", priorityBucket: "do_now", due: iso(-1) }),
      makeTask({ lifecycle: "done", priorityBucket: "do_now", due: iso(-1) }),
      makeTask({ lifecycle: "dropped", priorityBucket: "do_now", due: iso(-1) }),
    ];
    const columns = selectBoardColumns(tasks, { lens: "today" }, NOW);
    const boardIds = columns.flatMap((column) => column.tasks.map((task) => task.id));
    const todayIds = selectTodayTasks(tasks).map((task) => task.id);
    // Membership matches the Today list. Someday and Done stay on the board
    // as columns but hold nothing — the lens never includes them.
    expect(boardIds.sort()).toEqual(todayIds.sort());
    expect(columns.find((column) => column.lifecycle === "someday")!.tasks).toEqual([]);
    expect(columns.find((column) => column.lifecycle === "done")!.tasks).toEqual([]);
    expect(boardIds).toHaveLength(3);
  });
});
