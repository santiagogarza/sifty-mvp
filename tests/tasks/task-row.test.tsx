// @vitest-environment jsdom
import { INCOMPLETE_CIRCLE_BORDER, TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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
    useStore.setState({ tasks: [makeTask()], labels: [] });
  });

  it("renders the incomplete circle with a visible (non-default) border", () => {
    // Regression: a global unlayered `* { border-color: var(--border) }` reset
    // defeats Tailwind border utilities, so the circle must carry an explicit
    // border color or it renders near-invisible and users cannot find/click it.
    render(<TaskRow task={makeTask()} onOpen={() => {}} labels={[]} />);
    const circle = screen.getByRole("button", { name: "Mark as done" });
    expect(circle.style.borderColor).toBe(INCOMPLETE_CIRCLE_BORDER);
    expect(circle.style.borderColor).not.toBe("");
  });

  it("does not force the explicit border on an already-done task", () => {
    render(<TaskRow task={makeTask({ lifecycle: "done" })} onOpen={() => {}} labels={[]} />);
    const circle = screen.getByRole("button", { name: "Mark as not done" });
    expect(circle.style.borderColor).toBe("");
  });

  it("clicking the circle marks the task done in the store", () => {
    const task = makeTask();
    useStore.setState({ tasks: [task], labels: [] });
    render(<TaskRow task={task} onOpen={() => {}} labels={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
  });
});
