// @vitest-environment jsdom
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** SIF-15: Duplicate from the sheet, by button and by Shift+D. */

const openDetail = vi.fn();
vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({ openDetail, openCapture: vi.fn(), openCommand: vi.fn() }),
}));
vi.mock("@/lib/ai/run-triage", () => ({
  runTriage: vi.fn(),
  isTriageInFlight: () => false,
}));

const task: Task = {
  id: "task_src",
  sourceText: "weekly review",
  sourceContext: null,
  title: "Weekly review",
  description: null,
  nextAction: "Open last week's notes",
  lifecycle: "active",
  aiStatus: "ready",
  aiError: null,
  aiAttempts: 1,
  urgency: 0.6,
  importance: 0.7,
  priorityBucket: "do_now",
  effort: "small",
  due: "2026-10-16",
  delegationCandidate: "self",
  assigneeName: null,
  confidence: 0.9,
  clarifyingQuestion: null,
  rationale: "Recurring ritual.",
  agentBrief: null,
  labelIds: [],
  subtasks: [{ id: "st_1", title: "Review calendar", done: true, order: 0 }],
  editedFields: [],
  createdAt: "2026-10-10T10:00:00.000Z",
  updatedAt: "2026-10-10T10:00:00.000Z",
  completedAt: null,
};

beforeEach(() => {
  useStore.setState({ tasks: [task], labels: [] });
  openDetail.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("TaskDetailSheet header", () => {
  it("shows the confidence pill once sifted, and the thinking line while organizing", () => {
    const { rerender } = render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    const pill = screen.getByTestId("confidence-pill");
    expect(pill).toHaveTextContent("Sifted · 90%");
    expect(pill).toHaveAttribute("data-band", "ok");

    useStore.setState({ tasks: [{ ...task, aiStatus: "running" }] });
    rerender(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);
    expect(screen.queryByTestId("confidence-pill")).toBeNull();
    expect(screen.getByText(/Sifty is organizing this/)).toBeInTheDocument();
  });
});

describe("TaskDetailSheet duplicate", () => {
  it("the Duplicate button creates the copy and opens it", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Duplicate task" }));

    const tasks = useStore.getState().tasks;
    expect(tasks).toHaveLength(2);
    const copy = tasks.find((t) => t.id !== "task_src")!;
    expect(copy.title).toBe("Weekly review (copy)");
    expect(copy.due).toBeNull();
    expect(copy.subtasks[0]!.done).toBe(false);
    expect(openDetail).toHaveBeenCalledWith(copy.id);
  });

  it("Shift+D duplicates from the panel, but not while typing in a field", async () => {
    const user = userEvent.setup();
    render(<TaskDetailSheet taskId="task_src" onClose={vi.fn()} />);

    // The panel itself holds focus on open.
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    await user.keyboard("{Shift>}D{/Shift}");
    expect(useStore.getState().tasks).toHaveLength(2);
    expect(openDetail).toHaveBeenCalledTimes(1);

    const title = screen.getByPlaceholderText("Task title");
    await user.click(title);
    await user.keyboard("{Shift>}D{/Shift}");
    expect(useStore.getState().tasks).toHaveLength(2);
    expect(openDetail).toHaveBeenCalledTimes(1);
  });
});
