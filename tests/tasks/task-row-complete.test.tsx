// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateTask = vi.fn();

vi.mock("@/lib/store/store", () => ({
  useStore: (selector: (s: { updateTask: typeof updateTask; labels: [] }) => unknown) =>
    selector({ updateTask, labels: [] }),
}));

const task: Task = {
  id: "task_test",
  sourceText: "Test task",
  sourceContext: null,
  title: "Test task",
  description: null,
  nextAction: null,
  lifecycle: "active",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.5,
  importance: 0.5,
  priorityBucket: "schedule",
  effort: "small",
  due: null,
  delegationCandidate: "self",
  assigneeName: null,
  confidence: 0.9,
  clarifyingQuestion: null,
  rationale: null,
  agentBrief: null,
  labelIds: [],
  subtasks: [],
  editedFields: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

describe("TaskRow complete checkbox", () => {
  beforeEach(() => {
    updateTask.mockClear();
  });

  it("uses a real 32px button hit target instead of ::after padding", () => {
    render(<TaskRow task={task} labels={[]} onOpen={() => {}} />);
    const btn = screen.getByRole("button", { name: "Mark as done" });
    expect(btn.className).toContain("size-8");
    expect(btn.className).not.toContain("after:content-['']");
  });

  it("marks the task done when the hit target is clicked", async () => {
    render(<TaskRow task={task} labels={[]} onOpen={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(updateTask).toHaveBeenCalledWith(task.id, { lifecycle: "done" });
  });
});
