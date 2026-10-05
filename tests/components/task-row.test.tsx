// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_1",
    sourceText: "Draft launch announcement",
    sourceContext: null,
    title: "Draft launch announcement for Sifty preview",
    description: null,
    nextAction: null,
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.8,
    importance: 0.8,
    priorityBucket: "do_now",
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

function seed(task: Task) {
  useStore.setState({ tasks: [task], labels: [], hydrated: true });
}

afterEach(() => {
  cleanup();
  useStore.setState({ tasks: [], labels: [] });
});

describe("TaskRow complete circle", () => {
  it("marks the task done when the row circle is clicked", async () => {
    const task = makeTask();
    seed(task);
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(<TaskRow task={task} onOpen={onOpen} labels={[]} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores the previous lifecycle when a completed row is unchecked", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: NOW });
    seed(task);
    const user = userEvent.setup();

    render(<TaskRow task={task} onOpen={vi.fn()} labels={[]} uncompleteTo="active" />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    const stored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(stored?.lifecycle).toBe("active");
    expect(stored?.completedAt).toBeNull();
  });
});
