// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import { statusLabel } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { useStore, type SiftyState } from "@/lib/store/store";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

function makeTask(id: string, lifecycle: Task["lifecycle"], overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${id}`,
    description: null,
    nextAction: null,
    lifecycle,
    aiStatus: "pending",
    aiError: null,
    aiAttempts: 0,
    urgency: 0.5,
    importance: 0.5,
    priorityBucket: "unset",
    effort: "small",
    due: null,
    delegationCandidate: "unsure",
    assigneeName: null,
    confidence: 0,
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

// Mock useStore to return a mock updateTask function
vi.mock("@/lib/store/store", () => {
  const updateTask = vi.fn();
  return {
    useStore: vi.fn((selector) => {
      const state = {
        updateTask,
        labels: [],
      };
      return selector(state);
    }),
  };
});

describe("TaskBoard", () => {
  it("renders column headers with statusLabel() output", () => {
    render(<TaskBoard tasks={[]} onOpen={vi.fn()} />);

    expect(screen.getByText("Inbox")).toBeInTheDocument();
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("Waiting on")).toBeInTheDocument();
    expect(screen.getByText("Someday")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    // Dropped is hidden by default
    expect(screen.queryByText("Dropped")).not.toBeInTheDocument();
  });

  it("renders empty columns when no tasks", () => {
    render(<TaskBoard tasks={[]} onOpen={vi.fn()} />);
    // 6 columns total (dropped is hidden, but its column might be rendered if shown)
    // Actually, only 5 are visible initially
    expect(screen.getAllByText("0")).toHaveLength(5);
  });

  it("renders one task in the right column", () => {
    const task = makeTask("1", "active");
    render(<TaskBoard tasks={[task]} onOpen={vi.fn()} />);

    expect(screen.getByText("Task 1")).toBeInTheDocument();
    // The Active column should have count 1, others 0
    const counts = screen.getAllByText(/^[01]$/);
    const ones = counts.filter((el) => el.textContent === "1");
    const zeros = counts.filter((el) => el.textContent === "0");
    expect(ones).toHaveLength(1);
    expect(zeros).toHaveLength(4);
  });

  it("advances card one column with Alt+Right", async () => {
    const user = userEvent.setup();
    const task = makeTask("1", "active");
    const onOpen = vi.fn();
    const updateTask = useStore((s: SiftyState) => s.updateTask);

    render(<TaskBoard tasks={[task]} onOpen={onOpen} />);

    // Click to select
    const card = screen.getByText("Task 1");
    await user.click(card);

    // Press Alt+Right
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    // Should update to waiting
    expect(updateTask).toHaveBeenCalledWith("1", { lifecycle: "waiting" });
  });

  it("advances card one column with Alt+Left", async () => {
    const user = userEvent.setup();
    const task = makeTask("1", "active");
    const onOpen = vi.fn();
    const updateTask = useStore((s: SiftyState) => s.updateTask);

    render(<TaskBoard tasks={[task]} onOpen={onOpen} />);

    // Click to select
    const card = screen.getByText("Task 1");
    await user.click(card);

    // Press Alt+Left
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    // Should update to inbox
    expect(updateTask).toHaveBeenCalledWith("1", { lifecycle: "inbox" });
  });

  it("opens detail on Enter", async () => {
    const user = userEvent.setup();
    const task = makeTask("1", "active");
    const onOpen = vi.fn();

    render(<TaskBoard tasks={[task]} onOpen={onOpen} />);

    // Click to select
    const card = screen.getByText("Task 1");
    await user.click(card);

    // Press Enter
    await user.keyboard("{Enter}");

    expect(onOpen).toHaveBeenCalledWith("1");
  });
});
