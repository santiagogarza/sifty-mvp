import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import { LIFECYCLE, type Task } from "@/lib/domain/types";
import {
  BOARD_COLUMNS,
  TODAY_BOARD_COLUMNS,
  selectBoardColumns,
  selectTodayBoardColumns,
} from "@/lib/store/board";
import {
  isTodayTask,
  selectDoneTasks,
  selectInboxTasks,
  selectTodayTasks,
} from "@/lib/store/selectors";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Board membership contract: a column shows exactly what its list route shows.
 * These tests exist to catch the board drifting away from the lists it mirrors.
 */

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

/** One task per stored status, so every column has exactly one occupant. */
function oneOfEach(): Task[] {
  return LIFECYCLE.map((lifecycle) => makeTask({ lifecycle }));
}

describe("board columns", () => {
  it("places every task in the column matching its stored status", () => {
    const tasks = oneOfEach();
    const columns = selectBoardColumns(tasks, STATUSES_IN_ORDER);

    expect(columns).toHaveLength(LIFECYCLE.length);
    for (const column of columns) {
      expect(column.tasks).toHaveLength(1);
      expect(column.tasks[0]?.lifecycle).toBe(column.status);
    }
  });

  it("returns columns in the order requested, not store order", () => {
    const columns = selectBoardColumns(oneOfEach(), ["done", "inbox"]);
    expect(columns.map((c) => c.status)).toEqual(["done", "inbox"]);
  });

  it("omits dropped from the default pipeline but keeps the rest in status order", () => {
    expect(BOARD_COLUMNS).toEqual(["inbox", "active", "waiting", "someday", "done"]);
    expect(BOARD_COLUMNS).not.toContain("dropped");
  });

  it("shows dropped only when it is asked for", () => {
    const tasks = oneOfEach();

    const withoutDropped = selectBoardColumns(tasks, BOARD_COLUMNS);
    expect(withoutDropped.some((c) => c.status === "dropped")).toBe(false);

    const withDropped = selectBoardColumns(tasks, [...BOARD_COLUMNS, "dropped"]);
    expect(withDropped.at(-1)?.status).toBe("dropped");
    expect(withDropped.at(-1)?.tasks).toHaveLength(1);
  });

  it("renders empty columns rather than dropping them when there are no tasks", () => {
    const columns = selectBoardColumns([], BOARD_COLUMNS);
    expect(columns).toHaveLength(BOARD_COLUMNS.length);
    expect(columns.every((c) => c.tasks.length === 0)).toBe(true);
  });
});

describe("board and list agree", () => {
  const tasks = [
    makeTask({ lifecycle: "inbox", title: "older inbox", createdAt: "2026-07-01T00:00:00Z" }),
    makeTask({ lifecycle: "inbox", title: "newer inbox", createdAt: "2026-07-20T00:00:00Z" }),
    makeTask({ lifecycle: "done", title: "done first", completedAt: "2026-07-19T00:00:00Z" }),
    makeTask({ lifecycle: "done", title: "done second", completedAt: "2026-07-02T00:00:00Z" }),
  ];

  it("orders a column exactly like its list route", () => {
    const columns = selectBoardColumns(tasks, BOARD_COLUMNS);
    const inbox = columns.find((c) => c.status === "inbox");
    const done = columns.find((c) => c.status === "done");

    expect(inbox?.tasks).toEqual(selectInboxTasks(tasks));
    expect(done?.tasks).toEqual(selectDoneTasks(tasks));
    // Guard the assertion above against passing on two empty arrays.
    expect(inbox?.tasks.map((t) => t.title)).toEqual(["newer inbox", "older inbox"]);
  });

  it("applies the search filter the same way the list does", () => {
    const args = { search: "newer" };
    const columns = selectBoardColumns(tasks, BOARD_COLUMNS, args);
    const inbox = columns.find((c) => c.status === "inbox");

    expect(inbox?.tasks).toEqual(selectInboxTasks(tasks, args));
    expect(inbox?.tasks.map((t) => t.title)).toEqual(["newer inbox"]);
  });

  it("applies the label filter the same way the list does", () => {
    const labelled = makeTask({ lifecycle: "inbox", labelIds: ["label_work"] });
    const all = [...tasks, labelled];
    const args = { labelId: "label_work" };

    const inbox = selectBoardColumns(all, BOARD_COLUMNS, args).find((c) => c.status === "inbox");
    expect(inbox?.tasks).toEqual(selectInboxTasks(all, args));
    expect(inbox?.tasks.map((t) => t.id)).toEqual([labelled.id]);
  });
});

describe("today board", () => {
  // `selectTodayTasks` reads the wall clock, so due dates below are only
  // stable relative to a pinned now.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  const tasks = [
    makeTask({ lifecycle: "inbox", due: iso(-1) }),
    makeTask({ lifecycle: "active", priorityBucket: "do_now" }),
    makeTask({ lifecycle: "waiting", due: iso(0) }),
    makeTask({ lifecycle: "waiting", due: iso(30) }),
    makeTask({ lifecycle: "someday", due: iso(-1) }),
    makeTask({ lifecycle: "done", due: iso(-1) }),
    makeTask({ lifecycle: "dropped", due: iso(-1) }),
  ];

  it("never offers a column Today cannot contain", () => {
    expect(TODAY_BOARD_COLUMNS).toEqual(["inbox", "active", "waiting"]);
    for (const status of ["someday", "done", "dropped"] as const) {
      expect(TODAY_BOARD_COLUMNS).not.toContain(status);
    }
  });

  it("contains only tasks the Today lens admits", () => {
    const columns = selectTodayBoardColumns(selectTodayTasks(tasks));
    const shown = columns.flatMap((c) => c.tasks);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((t) => isTodayTask(t, NOW))).toBe(true);
    expect(shown.some((t) => t.lifecycle === "someday")).toBe(false);
    expect(shown.some((t) => t.lifecycle === "done")).toBe(false);
    expect(shown.some((t) => t.lifecycle === "dropped")).toBe(false);
  });

  it("holds back the waiting task with no due pressure, like the Today list", () => {
    const columns = selectTodayBoardColumns(selectTodayTasks(tasks));
    const waiting = columns.find((c) => c.status === "waiting");

    expect(waiting?.tasks.map((t) => t.due)).toEqual([iso(0)]);
  });

  it("partitions exactly the Today list, losing nothing", () => {
    const list = selectTodayTasks(tasks);
    const shown = selectTodayBoardColumns(list).flatMap((c) => c.tasks);

    expect(new Set(shown.map((t) => t.id))).toEqual(new Set(list.map((t) => t.id)));
  });
});
