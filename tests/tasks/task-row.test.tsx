// @vitest-environment jsdom

import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row1",
    sourceText: "Ship the note",
    sourceContext: null,
    title: "Ship the note",
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

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], hydrated: true });
});

describe("TaskRow complete", () => {
  it("sets lifecycle to done and does not open the row", async () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    const stored = useStore.getState().tasks[0];
    expect(stored?.lifecycle).toBe("done");
    expect(stored?.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores uncompleteTo and clears completedAt", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: "2026-07-22T12:00:00.000Z" });
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();

    render(<TaskRow task={task} labels={[]} onOpen={vi.fn()} uncompleteTo="waiting" />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    const stored = useStore.getState().tasks[0];
    expect(stored?.lifecycle).toBe("waiting");
    expect(stored?.completedAt).toBeNull();
  });
});
