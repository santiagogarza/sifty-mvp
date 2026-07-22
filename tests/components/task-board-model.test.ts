import {
  TASK_BOARD_COLUMNS,
  isTaskBoardLifecycle,
  taskBoardLifecycleAfter,
} from "@/components/tasks/task-board-model";
import { describe, expect, it } from "vitest";

describe("task board model", () => {
  it("keeps the board ordered by the task lifecycle flow", () => {
    expect(TASK_BOARD_COLUMNS.map((column) => column.lifecycle)).toEqual([
      "inbox",
      "active",
      "waiting",
      "someday",
      "done",
    ]);
  });

  it("moves left and right within board lifecycles", () => {
    expect(taskBoardLifecycleAfter("inbox", 1)).toBe("active");
    expect(taskBoardLifecycleAfter("waiting", -1)).toBe("active");
    expect(taskBoardLifecycleAfter("done", -1)).toBe("someday");
  });

  it("does not move past board edges or include dropped tasks", () => {
    expect(taskBoardLifecycleAfter("inbox", -1)).toBeNull();
    expect(taskBoardLifecycleAfter("done", 1)).toBeNull();
    expect(taskBoardLifecycleAfter("dropped", -1)).toBeNull();
    expect(taskBoardLifecycleAfter("dropped", 1)).toBeNull();
    expect(isTaskBoardLifecycle("dropped")).toBe(false);
  });
});
