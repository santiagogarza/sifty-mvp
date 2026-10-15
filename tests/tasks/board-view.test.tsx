// @vitest-environment jsdom
import { BoardView, UNDO_WINDOW_MS } from "@/components/tasks/board-view";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  const at = new Date(Date.UTC(2026, 6, 1, 0, seq)).toISOString();
  return {
    id: `task_bv_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: `Card ${seq}`,
    description: null,
    nextAction: null,
    lifecycle: "inbox",
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
    completedAt: patch.lifecycle === "done" ? at : null,
    ...patch,
  };
}

/** Renders the board against the live store, re-rendering on writes. */
function Harness({ onOpen }: { onOpen: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} />;
}

function setup(tasks: Task[]) {
  useStore.setState({ tasks, labels: [], hydrated: true });
  const onOpen = vi.fn();
  render(<Harness onOpen={onOpen} />);
  return { onOpen, board: screen.getByRole("group", { name: "Board" }) };
}

const lifecycleOf = (id: string) => useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
const column = (label: string) => screen.getByRole("region", { name: label });
/** The undo pill; dnd-kit's live region is a second role="status". */
const pill = () =>
  screen.queryAllByRole("status").find((el) => el.textContent?.includes("Moved to")) ?? null;
const key = (el: HTMLElement, k: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(el, { key: k, ...init });

describe("BoardView", () => {
  beforeEach(() => {
    useStore.setState({ tasks: [], labels: [] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the five status columns in pipeline order", () => {
    setup([makeTask({})]);
    const names = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual(["Inbox", "Focus", "Waiting on", "Someday", "Done"]);
  });

  it("is silent when there are no tasks: zero counts, no copy, no hint", () => {
    setup([]);
    for (const label of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
      expect(within(column(label)).getByText("0")).toBeInTheDocument();
    }
    expect(screen.queryByText("to file")).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing|empty|zero/i)).not.toBeInTheDocument();
  });

  it("shows the keyboard hint once there are cards", () => {
    setup([makeTask({})]);
    expect(screen.getByText("to file")).toBeInTheDocument();
  });

  it("Shift+Right files an Inbox card into Focus and offers undo", () => {
    const task = makeTask({ lifecycle: "inbox" });
    const { board } = setup([task]);

    key(board, "ArrowDown");
    key(board, "ArrowRight", { shiftKey: true });

    expect(lifecycleOf(task.id)).toBe("active");
    expect(within(column("Focus")).getByText(task.title)).toBeInTheDocument();
    expect(pill()).toHaveTextContent("Moved to Focus");
  });

  it("Shift+Right on a Done card does nothing", () => {
    const task = makeTask({ lifecycle: "done" });
    const { board } = setup([task]);
    const before = useStore.getState().tasks.find((t) => t.id === task.id);

    key(board, "ArrowDown");
    key(board, "ArrowRight", { shiftKey: true });

    expect(useStore.getState().tasks.find((t) => t.id === task.id)).toBe(before);
    expect(pill()).toBeNull();
  });

  it("arrows move the selection across columns before filing", () => {
    const inbox = makeTask({ lifecycle: "inbox" });
    const waiting = makeTask({ lifecycle: "waiting" });
    const { board } = setup([inbox, waiting]);

    key(board, "ArrowDown"); // selects the first card (Inbox)
    key(board, "ArrowRight"); // Focus is empty
    key(board, "ArrowRight"); // Waiting on
    key(board, "ArrowRight", { shiftKey: true });

    expect(lifecycleOf(inbox.id)).toBe("inbox");
    expect(lifecycleOf(waiting.id)).toBe("someday");
  });

  it("Enter opens the selected card", () => {
    const task = makeTask({});
    const { board, onOpen } = setup([task]);
    key(board, "ArrowDown");
    key(board, "Enter");
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("a click without pointer movement opens the card", () => {
    const task = makeTask({});
    const { onOpen } = setup([task]);
    const card = screen.getByText(task.title);
    fireEvent.pointerDown(card, { isPrimary: true, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(card, { isPrimary: true, button: 0, pointerType: "mouse" });
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("Undo restores the previous lifecycle by click", () => {
    const task = makeTask({ lifecycle: "inbox" });
    const { board } = setup([task]);
    key(board, "ArrowDown");
    key(board, "ArrowRight", { shiftKey: true });
    expect(lifecycleOf(task.id)).toBe("active");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(lifecycleOf(task.id)).toBe("inbox");
    expect(pill()).toBeNull();
  });

  it("Ctrl+Z restores the previous lifecycle, and a newer move replaces the older undo", () => {
    const a = makeTask({ lifecycle: "inbox" });
    const { board } = setup([a]);
    key(board, "ArrowDown");
    key(board, "ArrowRight", { shiftKey: true }); // inbox -> active
    key(board, "ArrowRight", { shiftKey: true }); // active -> waiting
    expect(pill()).toHaveTextContent("Moved to Waiting on");

    key(board, "z", { ctrlKey: true });
    expect(lifecycleOf(a.id)).toBe("active");

    key(board, "z", { ctrlKey: true });
    expect(lifecycleOf(a.id)).toBe("active");
  });

  it("Ctrl+Z does nothing once the undo window has passed", () => {
    vi.useFakeTimers();
    const task = makeTask({ lifecycle: "inbox" });
    const { board } = setup([task]);
    key(board, "ArrowDown");
    key(board, "ArrowRight", { shiftKey: true });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 10);
    });
    expect(pill()).toBeNull();

    key(board, "z", { ctrlKey: true });
    expect(lifecycleOf(task.id)).toBe("active");
  });

  it("ignores shortcuts typed into an editable field", () => {
    const task = makeTask({ lifecycle: "inbox" });
    const { board } = setup([task]);
    key(board, "ArrowDown");
    const input = document.createElement("input");
    board.appendChild(input);
    key(input, "ArrowRight", { shiftKey: true });
    expect(lifecycleOf(task.id)).toBe("inbox");
    input.remove();
  });

  it("completing from a card sends it to Done; unchecking restores where it came from", () => {
    const task = makeTask({ lifecycle: "waiting" });
    setup([task]);

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(lifecycleOf(task.id)).toBe("done");
    expect(pill()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(lifecycleOf(task.id)).toBe("waiting");
  });

  it("unchecking a card completed elsewhere falls back to Focus", () => {
    const task = makeTask({ lifecycle: "done" });
    setup([task]);
    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(lifecycleOf(task.id)).toBe<Lifecycle>("active");
  });
});
