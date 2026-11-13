// @vitest-environment jsdom
import { SnoozeMenu } from "@/components/tasks/snooze-menu";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared snooze menu. Tomorrow is the default, the date cannot be
 * today or earlier, and a task that is already snoozed can be brought back.
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_1",
    sourceText: "Park this",
    sourceContext: null,
    title: "Park this",
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.4,
    importance: 0.4,
    priorityBucket: "do_now",
    effort: "small",
    due: null,
    snoozeUntil: null,
    delegationCandidate: "self",
    assigneeName: null,
    confidence: 0.8,
    clarifyingQuestion: null,
    rationale: null,
    agentBrief: null,
    siftId: null,
    siftStage: null,
    plan: null,
    recurrence: null,
    seriesId: null,
    siftedWithAssumptions: false,
    labelIds: [],
    subtasks: [],
    editedFields: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const originalUpdateTask = useStore.getState().updateTask;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday 13 Nov 2026, noon UTC. Tomorrow and this weekend are both the 14th.
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useStore.setState({ updateTask: originalUpdateTask });
});

function renderMenu(task: Task, variant?: "row" | "header") {
  const updateTask = vi.fn();
  useStore.setState({ updateTask: updateTask as typeof originalUpdateTask });
  const onRow = vi.fn();
  render(
    <div onClick={onRow} onKeyDown={onRow}>
      <SnoozeMenu task={task} variant={variant} />
    </div>,
  );
  return { updateTask, onRow };
}

describe("SnoozeMenu", () => {
  it("offers tomorrow first, and choosing it sets that date without opening the row", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { updateTask, onRow } = renderMenu(makeTask());

    await user.click(screen.getByTestId("snooze-trigger"));
    expect(screen.getByTestId("snooze-tomorrow")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("snooze-weekend")).toHaveTextContent("Nov 14");
    expect(screen.getByTestId("snooze-next-week")).toHaveTextContent("Nov 16");
    expect(screen.getByTestId("snooze-date")).toHaveAttribute("min", "2026-11-14");
    expect(screen.getByTestId("snooze-date")).toHaveValue("2026-11-14");

    await user.click(screen.getByTestId("snooze-tomorrow"));
    expect(updateTask).toHaveBeenCalledWith("task_1", { snoozeUntil: "2026-11-14" });
    expect(onRow).not.toHaveBeenCalled();
  });

  it("hides This weekend on Sunday", async () => {
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMenu(makeTask());

    await user.click(screen.getByTestId("snooze-trigger"));
    expect(screen.queryByTestId("snooze-weekend")).toBeNull();
    expect(screen.getByTestId("snooze-tomorrow")).toBeInTheDocument();
    expect(screen.getByTestId("snooze-date")).toHaveAttribute("min", "2026-11-16");
  });

  it("ignores a date that is today or earlier", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { updateTask } = renderMenu(makeTask());
    await user.click(screen.getByTestId("snooze-trigger"));

    fireEvent.change(screen.getByTestId("snooze-date"), { target: { value: "2026-11-13" } });
    expect(updateTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("snooze-date"), { target: { value: "2026-11-18" } });
    expect(updateTask).toHaveBeenCalledWith("task_1", { snoozeUntil: "2026-11-18" });
  });

  it("brings a snoozed task back", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { updateTask } = renderMenu(makeTask({ snoozeUntil: "2026-11-20" }), "header");

    expect(screen.getByTestId("snooze-trigger")).toHaveTextContent("Nov 20");
    await user.click(screen.getByTestId("snooze-trigger"));
    expect(screen.getByText(/8:00/)).toBeInTheDocument();
    await user.click(screen.getByTestId("snooze-bring-back"));
    expect(updateTask).toHaveBeenCalledWith("task_1", { snoozeUntil: null });
  });

  it("is absent for done and dropped tasks", () => {
    const { unmount } = render(<SnoozeMenu task={makeTask({ lifecycle: "done" })} />);
    expect(screen.queryByTestId("snooze-trigger")).toBeNull();
    unmount();
    render(<SnoozeMenu task={makeTask({ lifecycle: "dropped" })} />);
    expect(screen.queryByTestId("snooze-trigger")).toBeNull();
  });
});
