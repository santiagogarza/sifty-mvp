import { partitionBoard } from "@/components/tasks/board-model";
import { STATUS_VIEWS } from "@/lib/domain/status";
import { selectDoneTasks, selectFocusTasks, selectInboxTasks } from "@/lib/store/selectors";
import { makeTask } from "@/tests/helpers/task";
import { describe, expect, it } from "vitest";

describe("board columns", () => {
  const tasks = [
    makeTask({
      id: "task_in_new",
      lifecycle: "inbox",
      createdAt: "2026-02-02T00:00:00.000Z",
    }),
    makeTask({
      id: "task_in_old",
      lifecycle: "inbox",
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
    makeTask({
      id: "task_focus",
      lifecycle: "active",
      priorityBucket: "do_now",
      urgency: 0.9,
      importance: 0.9,
    }),
    makeTask({
      id: "task_done_new",
      lifecycle: "done",
      completedAt: "2026-03-02T00:00:00.000Z",
    }),
    makeTask({
      id: "task_done_old",
      lifecycle: "done",
      completedAt: "2026-01-02T00:00:00.000Z",
    }),
    makeTask({ id: "task_drop", lifecycle: "dropped" }),
  ];

  it("matches STATUS_VIEWS and omits Dropped and Today", () => {
    const statuses = partitionBoard(tasks).map((column) => column.status);
    expect(statuses).toEqual(STATUS_VIEWS.map((column) => column.status));
    expect(statuses).not.toContain("dropped");
    expect(statuses).not.toContain("today");
  });

  it("keeps the list selectors' order and leaves dropped tasks off the board", () => {
    const board = partitionBoard(tasks);
    const ids = (status: string) =>
      board.find((column) => column.status === status)?.tasks.map((task) => task.id);

    expect(ids("inbox")).toEqual(selectInboxTasks(tasks).map((task) => task.id));
    expect(ids("active")).toEqual(selectFocusTasks(tasks).map((task) => task.id));
    expect(ids("done")).toEqual(selectDoneTasks(tasks).map((task) => task.id));
    expect(ids("inbox")).toEqual(["task_in_new", "task_in_old"]);
    expect(ids("done")).toEqual(["task_done_new", "task_done_old"]);
    expect(
      board.flatMap((column) => column.tasks).some((task) => task.lifecycle === "dropped"),
    ).toBe(false);
  });
});
