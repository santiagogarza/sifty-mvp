// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTask = vi.fn();

vi.mock("@/lib/store/store", () => ({
  useStore: vi.fn((selector: (state: { updateTask: typeof updateTask }) => unknown) =>
    selector({ updateTask }),
  ),
}));

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    sourceText: "test",
    sourceContext: null,
    title: "Draft launch announcement",
    description: null,
    nextAction: null,
    lifecycle: "active",
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
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}

describe("TaskRow complete circle", () => {
  beforeEach(() => {
    updateTask.mockReset();
  });

  it("marks an active task done when the list-row circle is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskRow task={makeTask()} labels={[]} onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(updateTask).toHaveBeenCalledWith("task_1", { lifecycle: "done" });
  });

  it("restores uncompleteTo when toggling a done task back", async () => {
    const user = userEvent.setup();
    render(
      <TaskRow
        task={makeTask({ lifecycle: "done", completedAt: "2026-07-22T12:00:00.000Z" })}
        labels={[]}
        onOpen={vi.fn()}
        uncompleteTo="waiting"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(updateTask).toHaveBeenCalledWith("task_1", { lifecycle: "waiting" });
  });

  it("does not open the row when completing from the circle", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<TaskRow task={makeTask()} labels={[]} onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
