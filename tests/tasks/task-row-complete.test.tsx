// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-10-05T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_complete",
    sourceText: "Send the investor update",
    sourceContext: null,
    title: "Send the investor update before the board sync on Thursday",
    description: null,
    nextAction: "Pull the three headline metrics",
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.6,
    importance: 0.8,
    priorityBucket: "schedule",
    effort: "small",
    due: "2026-10-08",
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

afterEach(() => {
  useStore.setState({ tasks: [], labels: [] });
});

describe("TaskRow complete circle", () => {
  it("marks the task done when the row circle is clicked", async () => {
    const task = makeTask();
    const onOpen = vi.fn();
    useStore.setState({ tasks: [task], labels: [], hydrated: true });

    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.lifecycle).toBe("done");
    expect(updated?.completedAt).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores uncompleteTo when a done row circle is clicked", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: NOW });
    useStore.setState({ tasks: [task], labels: [], hydrated: true });

    render(<TaskRow task={task} labels={[]} onOpen={() => {}} uncompleteTo="waiting" />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.lifecycle).toBe("waiting");
    expect(updated?.completedAt).toBeNull();
  });
});
