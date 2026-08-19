// @vitest-environment jsdom
import { initialState } from "@/lib/pomodoro/machine";
import { usePomodoro } from "@/lib/pomodoro/store";
import { useStore } from "@/lib/store/store";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Counting is wired through the store, not the UI, so anything that closes a
 * task — a row checkbox, the detail sheet, the command palette — lands in the
 * open focus block the same way.
 */

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], memories: [] });
  usePomodoro.setState({ timer: initialState() });
});

function capture(sourceText: string): string {
  return useStore.getState().createTask({ sourceText }).id;
}

function completions() {
  return usePomodoro.getState().timer.block?.completions ?? [];
}

describe("completions during a focus block", () => {
  it("counts tasks and subtasks closed while the block is open", () => {
    const taskId = capture("Ship the thing");
    useStore.getState().addSubtask(taskId, "Write the plan");
    usePomodoro.getState().startFocus();

    useStore.getState().updateTask(taskId, { lifecycle: "done" });
    const subtaskId = useStore.getState().tasks[0]!.subtasks[0]!.id;
    useStore.getState().toggleSubtask(taskId, subtaskId);

    expect(completions().map((c) => [c.kind, c.title])).toEqual([
      ["task", "Ship the thing"],
      ["subtask", "Write the plan"],
    ]);
  });

  it("retracts credit when something is un-checked in the same block", () => {
    const taskId = capture("Ship the thing");
    usePomodoro.getState().startFocus();

    useStore.getState().updateTask(taskId, { lifecycle: "done" });
    expect(completions()).toHaveLength(1);

    useStore.getState().updateTask(taskId, { lifecycle: "active" });
    expect(completions()).toHaveLength(0);
  });

  it("does not count work done before the block or after it closes", () => {
    const before = capture("Done earlier");
    useStore.getState().updateTask(before, { lifecycle: "done" });

    usePomodoro.getState().startFocus();
    const during = capture("Done in the block");
    useStore.getState().updateTask(during, { lifecycle: "done" });
    expect(completions()).toHaveLength(1);

    usePomodoro.getState().startBreak();
    const onBreak = capture("Done on the break");
    useStore.getState().updateTask(onBreak, { lifecycle: "done" });

    const history = usePomodoro.getState().timer.history;
    expect(history[0]?.completions.map((c) => c.title)).toEqual(["Done in the block"]);
  });

  it("ignores edits that don't change whether a task is done", () => {
    const taskId = capture("Ship the thing");
    usePomodoro.getState().startFocus();
    useStore.getState().updateTask(taskId, { lifecycle: "done" });
    useStore.getState().updateTask(taskId, { title: "Ship the thing, properly" });

    expect(completions()).toHaveLength(1);
  });
});
