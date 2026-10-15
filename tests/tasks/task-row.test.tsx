// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(patch: Partial<Task>): Task {
  const now = new Date().toISOString();
  return {
    id: "task_row_1",
    sourceText: "test",
    sourceContext: null,
    title: "Row task",
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...patch,
  };
}

function renderRow(task: Task, props: { uncompleteTo?: Task["lifecycle"] } = {}) {
  const onOpen = vi.fn();
  render(<TaskRow task={task} labels={[]} onOpen={onOpen} {...props} />);
  return { onOpen };
}

const live = (id: string) => useStore.getState().tasks.find((t) => t.id === id);

describe("TaskRow complete button", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [], hydrated: true });
  });
  afterEach(cleanup);

  it("marks the task done without opening it", () => {
    const task = makeTask({ lifecycle: "active" });
    useStore.setState({ tasks: [task] });
    const { onOpen } = renderRow(task);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(live(task.id)?.lifecycle).toBe("done");
    expect(live(task.id)?.completedAt).not.toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("unchecking restores the uncompleteTo status", () => {
    const task = makeTask({ lifecycle: "done", completedAt: new Date().toISOString() });
    useStore.setState({ tasks: [task] });
    renderRow(task, { uncompleteTo: "waiting" });

    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(live(task.id)?.lifecycle).toBe("waiting");
    expect(live(task.id)?.completedAt).toBeNull();
  });
});
