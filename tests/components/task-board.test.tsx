// @vitest-environment jsdom

import { TaskBoard } from "@/components/tasks/task-board";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { registerSyncHooks, useStore } from "@/lib/store/store";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(id: string, title: string, lifecycle: Lifecycle): Task {
  return {
    id,
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: null,
    lifecycle,
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "self",
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    completedAt: null,
  };
}

function BoardHarness({ onOpen = vi.fn() }: { onOpen?: (id: string) => void }) {
  const tasks = useStore((state) => state.tasks);
  return <TaskBoard tasks={tasks} onOpen={onOpen} />;
}

describe("TaskBoard", () => {
  beforeEach(() => {
    registerSyncHooks(null);
    useStore.setState({
      hydrated: true,
      tasks: [
        makeTask("task_inbox", "Review launch plan", "inbox"),
        makeTask("task_active", "Write release notes", "active"),
      ],
      labels: [],
      memories: [],
    });
  });

  it("moves a card to the next lifecycle with the explicit move control", async () => {
    const user = userEvent.setup();
    render(<BoardHarness />);

    await user.click(screen.getByRole("button", { name: "Move Review launch plan right" }));

    expect(useStore.getState().tasks.find((task) => task.id === "task_inbox")?.lifecycle).toBe(
      "active",
    );
  });

  it("moves a card when it is dropped on a column", () => {
    render(<BoardHarness />);

    const dataTransfer = {
      dropEffect: "move",
      effectAllowed: "move",
      getData: vi.fn(() => "task_inbox"),
      setData: vi.fn(),
    };

    fireEvent.drop(screen.getByRole("region", { name: "Waiting" }), { dataTransfer });

    expect(useStore.getState().tasks.find((task) => task.id === "task_inbox")?.lifecycle).toBe(
      "waiting",
    );
  });

  it("opens the task detail from a board card", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<BoardHarness onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Open Review launch plan" }));

    expect(onOpen).toHaveBeenCalledWith("task_inbox");
  });
});
