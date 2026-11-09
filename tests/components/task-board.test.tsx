// @vitest-environment jsdom
import { UNDO_WINDOW_MS } from "@/components/tasks/move-undo-toast";
import { TaskBoard } from "@/components/tasks/task-board";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Board behavior that isn't drag geometry (the e2e spec drags for real):
 * keyboard selection and filing, undo, opening, completing, and the
 * column affordances.
 */

let seq = 0;
function makeTask(title: string, lifecycle: Lifecycle): Task {
  seq += 1;
  const at = new Date(Date.UTC(2026, 6, 1, 9, seq)).toISOString();
  return {
    id: `task_kb_${seq}`,
    sourceText: title,
    sourceContext: null,
    title,
    description: null,
    nextAction: null,
    lifecycle,
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
    createdAt: at,
    updatedAt: at,
    completedAt: lifecycle === "done" ? at : null,
  };
}

const lifecycleOf = (id: string) => useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
const column = (label: string) => screen.getByRole("list", { name: new RegExp(`^${label}, `) });
const press = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });

let inboxTask: Task;
let doneTask: Task;

function renderBoard() {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  render(<TaskBoard onOpen={onOpen} onAdd={onAdd} />);
  return { onOpen, onAdd };
}

beforeEach(() => {
  inboxTask = makeTask("Book flights", "inbox");
  doneTask = makeTask("Renew passport", "done");
  useStore.setState({
    hydrated: true,
    labels: [],
    tasks: [inboxTask, makeTask("Draft the update", "active"), doneTask],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskBoard", () => {
  it("renders one labelled column per status with its count", () => {
    renderBoard();
    expect(screen.getAllByRole("list").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Inbox, 1 task",
      "Focus, 1 task",
      "Waiting on, 0 tasks",
      "Someday, 0 tasks",
      "Done, 1 task",
    ]);
    expect(within(column("Inbox")).getByText("Book flights")).toBeInTheDocument();
  });

  it("files the selected card one column over with Shift+→, and Ctrl+Z puts it back", () => {
    renderBoard();
    press("ArrowRight");
    expect(document.activeElement).toHaveAttribute("data-task-id", inboxTask.id);

    press("ArrowRight", { shiftKey: true });
    expect(lifecycleOf(inboxTask.id)).toBe("active");
    expect(within(column("Focus")).getByText("Book flights")).toBeInTheDocument();
    expect(screen.getByText(/Moved to/)).toHaveTextContent("Moved to Focus");
    // Focus followed the card into its new column.
    expect(document.activeElement).toHaveAttribute("data-task-id", inboxTask.id);

    press("z", { ctrlKey: true });
    expect(lifecycleOf(inboxTask.id)).toBe("inbox");
    expect(within(column("Inbox")).getByText("Book flights")).toBeInTheDocument();
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
  });

  it("does nothing when filing past either end of the board", () => {
    renderBoard();
    press("ArrowRight"); // Book flights (Inbox)
    press("ArrowLeft", { shiftKey: true });
    expect(lifecycleOf(inboxTask.id)).toBe("inbox");

    press("ArrowRight");
    press("ArrowRight"); // Renew passport (Done)
    expect(document.activeElement).toHaveAttribute("data-task-id", doneTask.id);
    press("ArrowRight", { shiftKey: true });
    expect(lifecycleOf(doneTask.id)).toBe("done");
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
  });

  it("undoes from the pill too, and the undo window closes", () => {
    vi.useFakeTimers();
    renderBoard();
    press("ArrowRight");
    press("ArrowRight", { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(lifecycleOf(inboxTask.id)).toBe("inbox");

    press("ArrowRight", { shiftKey: true });
    expect(lifecycleOf(inboxTask.id)).toBe("active");
    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 500);
    });
    expect(screen.queryByText(/Moved to/)).not.toBeInTheDocument();
    press("z", { ctrlKey: true });
    expect(lifecycleOf(inboxTask.id)).toBe("active");
  });

  it("opens a card with Enter or a click", () => {
    const { onOpen } = renderBoard();
    press("ArrowRight");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith(inboxTask.id);

    fireEvent.click(within(column("Done")).getByText("Renew passport"));
    expect(onOpen).toHaveBeenLastCalledWith(doneTask.id);
  });

  it("completes from the card and unchecking restores the status it came from", () => {
    const { onOpen } = renderBoard();
    const card = within(column("Inbox")).getByRole("button", { name: "Book flights" });
    fireEvent.click(within(card).getByRole("button", { name: "Mark as done" }));
    expect(lifecycleOf(inboxTask.id)).toBe("done");
    expect(onOpen).not.toHaveBeenCalled();

    const doneCard = within(column("Done")).getByRole("button", { name: "Book flights" });
    fireEvent.click(within(doneCard).getByRole("button", { name: "Mark as not done" }));
    expect(lifecycleOf(inboxTask.id)).toBe("inbox");
  });

  it("offers Add on every column except Done", () => {
    const { onAdd } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add a task to Waiting on" }));
    expect(onAdd).toHaveBeenCalledWith("waiting");
    expect(screen.queryByRole("button", { name: "Add a task to Done" })).not.toBeInTheDocument();
  });

  it("stays silent when empty: five empty columns and no keyboard hint", () => {
    useStore.setState({ tasks: [] });
    renderBoard();
    expect(screen.getAllByRole("list")).toHaveLength(5);
    expect(screen.getByRole("list", { name: "Inbox, 0 tasks" })).toBeInTheDocument();
    expect(screen.queryByText("to select")).not.toBeInTheDocument();
  });
});
