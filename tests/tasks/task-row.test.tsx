// @vitest-environment jsdom

import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The list circle is the same lifecycle write as the status picker.
 * Completion ghosts in TaskList restore `uncompleteTo` only if this click
 * actually changes the store.
 */

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

function taskFromStore(): Task {
  const task = useStore.getState().tasks[0];
  if (!task) throw new Error("expected a task");
  return task;
}

describe("TaskRow complete", () => {
  it("marks a task done and restores uncompleteTo on uncheck", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    useStore.getState().createTask({ sourceText: "Ship the board" });

    const { rerender } = render(<TaskRow task={taskFromStore()} labels={[]} onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    const done = taskFromStore();
    expect(done.lifecycle).toBe("done");
    expect(done.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();

    rerender(<TaskRow task={done} labels={[]} onOpen={onOpen} uncompleteTo="waiting" />);

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    const restored = taskFromStore();
    expect(restored.lifecycle).toBe("waiting");
    expect(restored.completedAt).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
