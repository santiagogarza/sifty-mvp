// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_test",
    sourceText: "Test task",
    sourceContext: null,
    title: "Test task",
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

describe("TaskRow complete circle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [makeTask()], labels: [], memories: [] });
  });

  it("marks an incomplete task done when the circle is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(<TaskRow task={makeTask()} labels={[]} onOpen={onOpen} uncompleteTo="active" />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores the prior lifecycle when un-completing from the circle", async () => {
    const user = userEvent.setup();
    useStore.setState({
      tasks: [makeTask({ lifecycle: "done", completedAt: NOW })],
    });

    render(
      <TaskRow
        task={makeTask({ lifecycle: "done", completedAt: NOW })}
        labels={[]}
        onOpen={vi.fn()}
        uncompleteTo="waiting"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");
  });
});
