// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "task_test_1",
    sourceText: "Ship the thing",
    sourceContext: null,
    title: "Ship the thing",
    description: null,
    nextAction: null,
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.5,
    importance: 0.5,
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

describe("TaskRow completion circle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [] });
  });

  it("clicking the circle marks an incomplete task done in the store", () => {
    // Regression guard: the circle's onClick must actually toggle lifecycle.
    // A prior regression left only stopPropagation, so the click did nothing.
    const task = makeTask({ lifecycle: "active" });
    useStore.setState({ tasks: [task], labels: [] });
    render(<TaskRow task={task} onOpen={() => {}} labels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
  });

  it("clicking the circle on a done task restores it to uncompleteTo", () => {
    const task = makeTask({ lifecycle: "done", completedAt: new Date().toISOString() });
    useStore.setState({ tasks: [task], labels: [] });
    render(<TaskRow task={task} onOpen={() => {}} labels={[]} uncompleteTo="waiting" />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("waiting");
  });

  it("clicking the circle does not open the task detail (stopPropagation)", () => {
    const task = makeTask();
    useStore.setState({ tasks: [task], labels: [] });
    const onOpen = vi.fn();
    render(<TaskRow task={task} onOpen={onOpen} labels={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
