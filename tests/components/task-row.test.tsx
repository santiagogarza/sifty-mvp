// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guards the list-row complete circle (SIF-18). `master` deliberately ships
 * this row without the `updateTask` call for demos; production must keep it.
 */

function makeTask(overrides: Partial<Task> & { id: string; lifecycle: Lifecycle }): Task {
  return {
    sourceText: overrides.id,
    sourceContext: null,
    title: overrides.id,
    description: null,
    nextAction: null,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const originalUpdateTask = useStore.getState().updateTask;

afterEach(() => {
  cleanup();
  useStore.setState({ updateTask: originalUpdateTask });
});

function renderRow(task: Task, uncompleteTo?: Lifecycle) {
  const updateTask = vi.fn();
  useStore.setState({ updateTask: updateTask as typeof originalUpdateTask });
  const onOpen = vi.fn();
  render(<TaskRow task={task} onOpen={onOpen} labels={[]} uncompleteTo={uncompleteTo} />);
  return { updateTask, onOpen };
}

describe("TaskRow complete circle", () => {
  it("marks an active task done without opening the sheet", async () => {
    const task = makeTask({ id: "task_1", lifecycle: "active" });
    const { updateTask, onOpen } = renderRow(task);

    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenCalledWith("task_1", { lifecycle: "done" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores the previous status when un-completing", async () => {
    const task = makeTask({ id: "task_2", lifecycle: "done" });
    const { updateTask } = renderRow(task, "waiting");

    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(updateTask).toHaveBeenCalledWith("task_2", { lifecycle: "waiting" });
  });

  it("defaults un-completing to active", async () => {
    const task = makeTask({ id: "task_3", lifecycle: "done" });
    const { updateTask } = renderRow(task);

    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(updateTask).toHaveBeenCalledWith("task_3", { lifecycle: "active" });
  });

  it("shows the compact Unsure pill only for low-confidence sifted tasks (SIF-11)", () => {
    const low = makeTask({ id: "task_low", lifecycle: "inbox", confidence: 0.38 });
    const { unmount } = render(<TaskRow task={low} onOpen={vi.fn()} labels={[]} />);
    expect(screen.getByTestId("confidence-pill")).toHaveTextContent("Unsure");
    unmount();

    const high = makeTask({ id: "task_high", lifecycle: "inbox", confidence: 0.9 });
    render(<TaskRow task={high} onOpen={vi.fn()} labels={[]} />);
    expect(screen.queryByTestId("confidence-pill")).toBeNull();
  });

  it("clicking the title opens the sheet and leaves lifecycle alone", async () => {
    const task = makeTask({ id: "task_4", lifecycle: "active", title: "Draft launch post" });
    const { updateTask, onOpen } = renderRow(task);

    await userEvent.click(screen.getByText("Draft launch post"));

    expect(onOpen).toHaveBeenCalledWith("task_4");
    expect(updateTask).not.toHaveBeenCalled();
  });
});
