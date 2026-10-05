// @vitest-environment jsdom
// This pragma has to stay above the imports. organizeImports is off for this file in biome.json.
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-10-04T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_complete",
    sourceText: "test",
    sourceContext: null,
    title: "Draft launch announcement",
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
    due: "2026-10-06",
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.9,
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
  localStorage.clear();
  useStore.setState({ tasks: [task], labels: [], hydrated: true });
}

describe("TaskRow complete circle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useStore.setState({ tasks: [], labels: [] });
  });

  it("marks the task done and does not open the row", async () => {
    const task = makeTask();
    seed(task);
    const onOpen = vi.fn();

    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
  });

  it("restores uncompleteTo when a done row is unchecked", async () => {
    const task = makeTask({ lifecycle: "done", completedAt: NOW });
    seed(task);

    render(<TaskRow task={task} labels={[]} onOpen={() => {}} uncompleteTo="inbox" />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("inbox");
  });
});
