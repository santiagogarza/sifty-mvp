// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-07-22T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_1",
    sourceText: "Team offsite",
    sourceContext: null,
    title: "Team offsite",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.2,
    importance: 0.3,
    priorityBucket: "unset",
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
    useStore.setState({ tasks: [], labels: [], memories: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("marks an open task done and does not open the row", async () => {
    const task = makeTask();
    useStore.setState({ tasks: [task] });
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
  });

  it("restores uncompleteTo when a done row is unchecked", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: NOW });
    useStore.setState({ tasks: [task] });
    const user = userEvent.setup();

    render(<TaskRow task={task} labels={[]} onOpen={() => {}} uncompleteTo="inbox" />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("inbox");
  });
});
