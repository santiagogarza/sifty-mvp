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

beforeEach(() => {
  window.localStorage.removeItem("sifty-store-v1");
  useStore.setState({ tasks: [makeTask()], labels: [], memories: [] });
});

afterEach(() => {
  cleanup();
});

describe("TaskRow complete circle", () => {
  it("marks the task done and does not open the row", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const task = useStore.getState().tasks[0];
    if (!task) throw new Error("missing seeded task");

    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);
    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
    const updated = useStore.getState().tasks.find((t) => t.id === task.id);
    expect(updated?.lifecycle).toBe("done");
    expect(updated?.completedAt).toBeTruthy();
  });

  it("restores uncompleteTo when a done row is unchecked", async () => {
    const user = userEvent.setup();
    const done = makeTask({ lifecycle: "done", completedAt: NOW });
    useStore.setState({ tasks: [done] });

    render(<TaskRow task={done} labels={[]} onOpen={vi.fn()} uncompleteTo="active" />);
    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === done.id)?.lifecycle).toBe("active");
  });
});
