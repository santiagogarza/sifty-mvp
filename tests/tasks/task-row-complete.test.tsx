// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-10-04T12:00:00.000Z";

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_row_complete",
    sourceText: "Draft launch announcement",
    sourceContext: null,
    title: "Draft launch announcement for Sifty preview",
    description: null,
    nextAction: "Write a one-paragraph outline",
    lifecycle: "active",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.6,
    importance: 0.7,
    priorityBucket: "schedule",
    effort: "small",
    due: "2026-10-06",
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

function seed(task: Task) {
  useStore.setState({ tasks: [task], labels: [] });
}

function Row({ onOpen = () => {} }: { onOpen?: (id: string) => void }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === "task_row_complete"));
  if (!task) return null;
  return <TaskRow task={task} labels={[]} onOpen={onOpen} uncompleteTo="active" />;
}

describe("TaskRow complete circle", () => {
  beforeEach(() => {
    seed(makeTask());
  });

  it("marks an active task done when the row circle is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<Row onOpen={onOpen} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("restores uncompleteTo when a done task's circle is clicked", async () => {
    seed(makeTask({ lifecycle: "done", completedAt: NOW }));
    const user = userEvent.setup();
    render(<Row />);

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });
});
