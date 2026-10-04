import { STATUS_VIEWS } from "@/lib/domain/status";
import {
  selectBoardColumns,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { describe, expect, it } from "vitest";
import { makeTask } from "../helpers/tasks";

/**
 * Board ↔ list contract: the columns are the status views, in their order,
 * and a column holds exactly what that view's list holds, in that order.
 */

const T0 = new Date("2026-07-22T12:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3600_000).toISOString();

describe("selectBoardColumns", () => {
  it("is exactly STATUS_VIEWS: five columns, pipeline order, no Dropped, no Today", () => {
    const columns = selectBoardColumns([]);
    expect(columns.map((c) => c.status)).toEqual(STATUS_VIEWS.map((v) => v.status));
    expect(columns.map((c) => c.status)).toEqual(["inbox", "active", "waiting", "someday", "done"]);
    expect(columns.map((c) => c.label)).toEqual([
      "Inbox",
      "Focus",
      "Waiting on",
      "Someday",
      "Done",
    ]);
    expect(columns.some((c) => (c.status as string) === "dropped")).toBe(false);
    expect(columns.some((c) => (c.status as string) === "today")).toBe(false);
  });

  it("partitions by lifecycle and keeps each view's sort", () => {
    const tasks = [
      makeTask({ lifecycle: "inbox", createdAt: at(1) }),
      makeTask({ lifecycle: "inbox", createdAt: at(3) }),
      makeTask({ lifecycle: "active", priorityBucket: "drop", urgency: 0.1, importance: 0.1 }),
      makeTask({ lifecycle: "active", priorityBucket: "do_now", urgency: 0.9, importance: 0.9 }),
      makeTask({ lifecycle: "waiting" }),
      makeTask({ lifecycle: "someday" }),
      makeTask({ lifecycle: "done", completedAt: at(1) }),
      makeTask({ lifecycle: "done", completedAt: at(5) }),
      makeTask({ lifecycle: "dropped" }),
    ];
    const byStatus = Object.fromEntries(selectBoardColumns(tasks).map((c) => [c.status, c.tasks]));

    expect(byStatus.inbox!.map((t) => t.id)).toEqual(selectInboxTasks(tasks).map((t) => t.id));
    expect(byStatus.active!.map((t) => t.id)).toEqual(selectFocusTasks(tasks).map((t) => t.id));
    expect(byStatus.done!.map((t) => t.id)).toEqual(selectDoneTasks(tasks).map((t) => t.id));
    expect(byStatus.waiting).toHaveLength(1);
    expect(byStatus.someday).toHaveLength(1);

    // Newest capture first; strongest focus first; most recently finished first.
    expect(byStatus.inbox![0]!.createdAt).toBe(at(3));
    expect(byStatus.active![0]!.priorityBucket).toBe("do_now");
    expect(byStatus.done![0]!.completedAt).toBe(at(5));

    // Dropped is in no column at all.
    const placed = new Set(Object.values(byStatus).flatMap((ts) => ts.map((t) => t.id)));
    expect(placed.size).toBe(8);
    expect(placed.has(tasks[8]!.id)).toBe(false);
  });
});
