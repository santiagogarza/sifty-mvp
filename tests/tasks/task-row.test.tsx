// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/tasks";

/**
 * The row's complete circle is the list's primary status write. It must
 * file the task through the store (and so through sync), not just swallow
 * the click.
 */

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

function renderRow(task: Task, uncompleteTo?: Task["lifecycle"]) {
  useStore.setState({ tasks: [task] });
  const onOpen = vi.fn();
  render(<TaskRow task={task} labels={[]} onOpen={onOpen} uncompleteTo={uncompleteTo} />);
  return { onOpen };
}

describe("TaskRow complete circle", () => {
  it("files the task to done and stamps completedAt without opening it", async () => {
    const task = makeTask({ lifecycle: "active" });
    const { onOpen } = renderRow(task);

    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    const stored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(stored?.lifecycle).toBe("done");
    expect(stored?.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("unchecking restores the status the row was told to go back to", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: new Date().toISOString() });
    renderRow(task, "waiting");

    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    const stored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(stored?.lifecycle).toBe("waiting");
    expect(stored?.completedAt).toBeNull();
  });

  it("defaults the uncheck destination to Focus", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: new Date().toISOString() });
    renderRow(task);

    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("active");
  });
});
