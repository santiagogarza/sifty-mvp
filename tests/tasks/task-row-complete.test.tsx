// @vitest-environment jsdom
import { TaskRow } from "@/components/tasks/task-row";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

const BASE_TASK: Task = {
  id: "task_row_complete_test",
  sourceText: "Ship the fix",
  sourceContext: null,
  title: "Ship the fix",
  description: null,
  nextAction: null,
  lifecycle: "active",
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
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z",
  completedAt: null,
};

describe("TaskRow complete circle", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [{ ...BASE_TASK }], labels: [] });
  });

  it("marks the task done when the list-row circle is clicked", async () => {
    const user = userEvent.setup();
    render(<TaskRow task={BASE_TASK} labels={[]} onOpen={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(useStore.getState().tasks[0]?.completedAt).not.toBeNull();
  });

  it("restores the prior lifecycle when uncompleting via uncompleteTo", async () => {
    useStore.setState({
      tasks: [{ ...BASE_TASK, lifecycle: "done", completedAt: "2026-08-18T12:01:00.000Z" }],
    });
    const user = userEvent.setup();
    render(
      <TaskRow
        task={{ ...BASE_TASK, lifecycle: "done", completedAt: "2026-08-18T12:01:00.000Z" }}
        labels={[]}
        onOpen={() => {}}
        uncompleteTo="waiting"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");
    expect(useStore.getState().tasks[0]?.completedAt).toBeNull();
  });
});
