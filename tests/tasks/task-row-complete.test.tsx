// @vitest-environment jsdom
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
    sourceText: "Team offsite",
    sourceContext: null,
    title: "Team offsite",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.5,
    priorityBucket: "schedule",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
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
    localStorage.clear();
    useStore.setState({ tasks: [], labels: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("marks an incomplete task done and does not open the row", async () => {
    const row = makeTask();
    useStore.setState({ tasks: [row] });
    const onOpen = vi.fn();

    render(<TaskRow task={row} onOpen={onOpen} labels={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(useStore.getState().tasks.find((t) => t.id === row.id)?.lifecycle).toBe("done");
  });

  it("restores uncompleteTo when a done row is unchecked", async () => {
    const row = makeTask({ lifecycle: "done", completedAt: NOW });
    useStore.setState({ tasks: [row] });

    render(<TaskRow task={row} onOpen={() => {}} labels={[]} uncompleteTo="inbox" />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    const stored = useStore.getState().tasks.find((t) => t.id === row.id);
    expect(stored?.lifecycle).toBe("inbox");
    expect(stored?.completedAt).toBeNull();
  });
});
