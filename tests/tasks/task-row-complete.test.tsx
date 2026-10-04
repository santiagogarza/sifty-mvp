// @vitest-environment jsdom

import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = "2026-10-04T00:00:00.000Z";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_row_1",
    sourceText: "Draft launch announcement",
    sourceContext: null,
    title: "Draft launch announcement for Sifty preview",
    description: null,
    nextAction: "Write a one-paragraph outline",
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
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

describe("TaskRow complete circle", () => {
  beforeEach(async () => {
    useStore.persist.clearStorage();
    await useStore.persist.rehydrate();
    useStore.setState({
      tasks: [makeTask()],
      labels: [],
      memories: [],
      hydrated: true,
    });
  });

  afterEach(() => {
    cleanup();
    useStore.persist.clearStorage();
  });

  it("marks an active task done when the row circle is clicked", async () => {
    const onOpen = vi.fn();
    const task = makeTask();
    useStore.setState({ tasks: [task] });
    render(<TaskRow task={task} labels={[]} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(useStore.getState().tasks.find((t) => t.id === task.id)?.lifecycle).toBe("done");
  });

  it("restores uncompleteTo when a done row circle is clicked", async () => {
    const done = makeTask({ id: "task_done", lifecycle: "done", completedAt: now });
    useStore.setState({ tasks: [done] });
    render(<TaskRow task={done} labels={[]} onOpen={() => {}} uncompleteTo="waiting" />);

    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks.find((t) => t.id === done.id)?.lifecycle).toBe("waiting");
  });
});
