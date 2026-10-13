// @vitest-environment jsdom

import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_1",
    sourceText: "Ship the list complete control",
    sourceContext: null,
    title: "Ship the list complete control",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
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

describe("TaskRow complete", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], hydrated: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("marks the task done and restores uncompleteTo", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "waiting" });
    useStore.setState({ tasks: [task] });
    const onOpen = vi.fn();

    const view = render(<TaskRow task={task} labels={[]} onOpen={onOpen} uncompleteTo="waiting" />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    const done = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(done?.lifecycle).toBe("done");
    expect(done?.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();

    view.rerender(<TaskRow task={done!} labels={[]} onOpen={onOpen} uncompleteTo="waiting" />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    const restored = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(restored?.lifecycle).toBe("waiting");
    expect(restored?.completedAt).toBeNull();
  });

  it("uncompletes to Focus when no prior status is given", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "done", completedAt: "2026-07-22T12:00:00.000Z" });
    useStore.setState({ tasks: [task] });

    render(<TaskRow task={task} labels={[]} onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });
});
