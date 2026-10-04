// @vitest-environment jsdom

import { TaskBoard } from "@/components/tasks/task-board";
import { STATUS_META } from "@/lib/domain/status";
import type { Label, Task } from "@/lib/domain/types";
import { BOARD_LIFECYCLES } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { formatRelativeDay } from "@/lib/utils/dates";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LABELS: Label[] = [
  { id: "label_work", name: "Work", tone: "mist" },
  { id: "label_home", name: "Home", tone: "sand" },
];

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_card_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Task ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
    aiStatus: "ready",
    aiError: null,
    aiAttempts: 1,
    urgency: 0.8,
    importance: 0.8,
    priorityBucket: "do_now",
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
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}

function renderBoard(onOpen = vi.fn(), onCapture = vi.fn()) {
  render(createElement(TaskBoard, { onOpen, onCapture }));
  return { onOpen, onCapture };
}

beforeEach(() => {
  seq = 0;
  window.localStorage.clear();
  useStore.setState({ tasks: [], labels: LABELS, hydrated: true, viewModes: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskBoard", () => {
  it("renders the five status columns and nothing else", () => {
    renderBoard();
    for (const lifecycle of BOARD_LIFECYCLES) {
      expect(
        screen.getByRole("region", { name: `${STATUS_META[lifecycle].label} column` }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: /dropped column/i })).toBeNull();
    expect(screen.queryByRole("region", { name: /today column/i })).toBeNull();
    expect(screen.queryByText(/nothing|empty|yet/i)).toBeNull();
  });

  it("shows title, next action, one badge, and the AI chip only while triage runs", () => {
    const due = "2026-01-02";
    useStore.setState({
      tasks: [
        makeTask({
          id: "delegated",
          title: "Ask Sam",
          nextAction: "Send the note",
          due,
          delegationCandidate: "person",
          assigneeName: "Sam",
          labelIds: ["label_work"],
          aiStatus: "pending",
        }),
        makeTask({
          id: "labeled",
          title: "Write the brief",
          labelIds: ["label_work", "label_home"],
          aiStatus: "ready",
        }),
        makeTask({
          id: "failed",
          title: "Retry later",
          aiStatus: "failed",
        }),
      ],
    });
    renderBoard();

    expect(screen.getByText("Ask Sam")).toBeInTheDocument();
    expect(screen.getByText("Send the note")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText(formatRelativeDay(due)!)).toBeInTheDocument();
    // Assignee wins the single extra badge; the label is not also shown.
    expect(screen.getAllByText("Work")).toHaveLength(1);
    expect(screen.getAllByText("Organizing")).toHaveLength(1);
    expect(screen.queryByText(/couldn't organize/i)).toBeNull();
  });

  it("files the selected card with Shift+Arrow and undoes it", () => {
    useStore.setState({
      tasks: [makeTask({ id: "move-me", title: "Move me", lifecycle: "inbox" })],
    });
    renderBoard();
    const board = screen.getByTestId("task-board");
    board.focus();

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks.find((task) => task.id === "move-me")?.lifecycle).toBe(
      "active",
    );
    expect(screen.getByText(/Moved to Focus/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(useStore.getState().tasks.find((task) => task.id === "move-me")?.lifecycle).toBe(
      "inbox",
    );
    expect(screen.queryByText(/Moved to/)).toBeNull();
  });

  it("retires the undo pill after 6 seconds and also undoes from the keyboard", () => {
    vi.useFakeTimers();
    useStore.setState({
      tasks: [makeTask({ id: "retire-me", title: "Retire me", lifecycle: "inbox" })],
    });
    renderBoard();
    const board = screen.getByTestId("task-board");

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByText(/Moved to Focus/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText(/Moved to/)).toBeNull();
    expect(useStore.getState().tasks.find((task) => task.id === "retire-me")?.lifecycle).toBe(
      "active",
    );

    useStore.getState().setLifecycle("retire-me", "inbox");
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(document, { key: "z", metaKey: true });
    expect(useStore.getState().tasks.find((task) => task.id === "retire-me")?.lifecycle).toBe(
      "inbox",
    );
  });

  it("opens the selected card on Enter and completes it from the circle", () => {
    const onOpen = vi.fn();
    useStore.setState({
      tasks: [makeTask({ id: "open-me", title: "Open me", lifecycle: "inbox" })],
    });
    renderBoard(onOpen);
    const board = screen.getByTestId("task-board");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("open-me");

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks.find((task) => task.id === "open-me")?.lifecycle).toBe("done");
    expect(
      useStore.getState().tasks.find((task) => task.id === "open-me")?.completedAt,
    ).toBeTruthy();
  });

  it("asks the column's Add row to capture into that status", () => {
    const onCapture = vi.fn();
    renderBoard(vi.fn(), onCapture);
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Focus" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Inbox" }));
    expect(onCapture).toHaveBeenNthCalledWith(1, "active");
    expect(onCapture).toHaveBeenNthCalledWith(2, "inbox");
  });
});
