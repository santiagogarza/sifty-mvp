// @vitest-environment jsdom
import { BOARD_UNDO_MS, BoardView } from "@/components/tasks/board-view";
import type { Task } from "@/lib/domain/types";
import { type SyncHooks, registerSyncHooks, useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTask(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    sourceText: id,
    sourceContext: null,
    title: `Card ${id}`,
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
    confidence: 0.9,
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
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}

/** Reads tasks from the store like TaskView does, so moves re-render. */
function Board({ onOpen = vi.fn() }: { onOpen?: (id: string) => void }) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} />;
}

const lifecycleOf = (id: string) => useStore.getState().tasks.find((t) => t.id === id)?.lifecycle;
const column = (name: string) => screen.getByRole("region", { name: `${name} column` });
const board = () => screen.getByTestId("board");
const press = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(board(), { key, ...mods });

let upserted: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useStore.setState({ tasks: [], labels: [], completedFrom: {} });
  upserted = vi.fn();
  registerSyncHooks({ taskUpserted: upserted } as unknown as SyncHooks);
});

afterEach(() => {
  registerSyncHooks(null);
  cleanup();
  vi.useRealTimers();
});

describe("BoardView layout", () => {
  it("renders the five status columns in sidebar order with counts", () => {
    useStore.setState({
      tasks: [
        makeTask("a"),
        makeTask("b", { lifecycle: "waiting" }),
        makeTask("c", { lifecycle: "dropped" }),
      ],
    });
    render(<Board />);
    const names = screen.getAllByRole("region").map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual([
      "Inbox column",
      "Focus column",
      "Waiting on column",
      "Someday column",
      "Done column",
    ]);
    expect(screen.getByTestId("column-count-inbox")).toHaveTextContent("1");
    expect(screen.getByTestId("column-count-waiting")).toHaveTextContent("1");
    expect(screen.queryByText("Card c")).toBeNull();
  });

  it("an empty workspace shows silent columns: zero counts, no copy, no hint", () => {
    render(<Board />);
    expect(screen.getAllByRole("region")).toHaveLength(5);
    for (const lc of ["inbox", "active", "waiting", "someday", "done"]) {
      expect(screen.getByTestId(`column-count-${lc}`)).toHaveTextContent("0");
    }
    expect(screen.queryByTestId("board-hint")).toBeNull();
    expect(screen.queryByText(/drop here|nothing|empty/i)).toBeNull();
  });

  it("every column but Done offers Add, which captures into that status", async () => {
    const onAdd = vi.fn();
    render(<BoardView tasks={[]} onOpen={vi.fn()} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add to Waiting on" }));
    expect(onAdd).toHaveBeenCalledWith("waiting");
    expect(screen.queryByRole("button", { name: "Add to Done" })).toBeNull();
  });
});

describe("BoardView cards", () => {
  it("the low-confidence card carries the compact confidence pill", () => {
    useStore.setState({ tasks: [makeTask("low", { confidence: 0.4 }), makeTask("high")] });
    render(<Board />);
    const pills = screen.getAllByTestId("confidence-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0]!.closest("[data-board-card]")).toHaveTextContent("Card low");
  });

  it("cards carry the labeled priority pill, and a repeat mark when the task repeats", () => {
    useStore.setState({
      tasks: [
        makeTask("rep", {
          recurrence: { freq: "monthly", mode: "fixed", dayOfMonth: 1 },
          seriesId: "rep",
        }),
        makeTask("plain", { priorityBucket: "unset" }),
      ],
    });
    render(<Board />);
    const rep = screen.getByText("Card rep").closest("[data-board-card]") as HTMLElement;
    expect(within(rep).getByTestId("priority-pill")).toHaveTextContent("Important");
    expect(within(rep).getByTestId("repeat-glyph")).toHaveAttribute(
      "aria-label",
      "Repeats monthly on the 1st",
    );
    const plain = screen.getByText("Card plain").closest("[data-board-card]") as HTMLElement;
    expect(within(plain).queryByTestId("priority-pill")).toBeNull();
    expect(within(plain).queryByTestId("repeat-glyph")).toBeNull();
  });

  it("shows one extra badge: the assignee for a hand-off, else the first label", () => {
    useStore.setState({
      labels: [
        { id: "l1", name: "Work", tone: "sage" },
        { id: "l2", name: "Home", tone: "sand" },
      ],
      tasks: [
        makeTask("handoff", {
          delegationCandidate: "person",
          assigneeName: "Ana",
          labelIds: ["l1"],
        }),
        makeTask("labeled", { labelIds: ["l1", "l2"], nextAction: "Draft the outline" }),
      ],
    });
    render(<Board />);
    const handoff = screen.getByText("Card handoff").closest("[data-board-card]") as HTMLElement;
    expect(handoff).toHaveTextContent("Ana");
    expect(handoff).not.toHaveTextContent("Work");
    const labeled = screen.getByText("Card labeled").closest("[data-board-card]") as HTMLElement;
    expect(labeled).toHaveTextContent("Work");
    expect(labeled).not.toHaveTextContent("Home");
    expect(labeled).toHaveTextContent("Draft the outline");
  });

  it("a click without movement opens the card", async () => {
    const onOpen = vi.fn();
    useStore.setState({ tasks: [makeTask("a")] });
    render(<Board onOpen={onOpen} />);
    await userEvent.click(screen.getByText("Card a"));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("completing sends a card to Done; unchecking restores the status it came from", async () => {
    useStore.setState({ tasks: [makeTask("w", { lifecycle: "waiting" })] });
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(lifecycleOf("w")).toBe("done");
    expect(within(column("Done")).getByText("Card w")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(lifecycleOf("w")).toBe("waiting");
  });

  it("unchecking a card finished in an earlier session falls back to Focus", async () => {
    useStore.setState({ tasks: [makeTask("old", { lifecycle: "done" })] });
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(lifecycleOf("old")).toBe("active");
  });
});

describe("BoardView keyboard", () => {
  it("Shift+Right files the selected Inbox card into Focus and offers undo", () => {
    useStore.setState({ tasks: [makeTask("a")] });
    render(<Board />);
    expect(board()).toHaveFocus();
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    expect(lifecycleOf("a")).toBe("active");
    expect(within(column("Focus")).getByText("Card a")).toBeInTheDocument();
    expect(screen.getByTestId("board-undo")).toHaveTextContent("Moved to Focus");
  });

  it("Shift+Right on a Done card does nothing: no write, no pill", () => {
    useStore.setState({ tasks: [makeTask("d", { lifecycle: "done" })] });
    render(<Board />);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    expect(lifecycleOf("d")).toBe("done");
    expect(upserted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("board-undo")).toBeNull();
  });

  it("arrows move between and within columns; Enter opens the selection", () => {
    const onOpen = vi.fn();
    useStore.setState({
      tasks: [
        makeTask("i1", { createdAt: "2026-07-02T10:00:00.000Z" }),
        makeTask("i2", { createdAt: "2026-07-01T10:00:00.000Z" }),
        makeTask("f1", { lifecycle: "active" }),
      ],
    });
    render(<Board onOpen={onOpen} />);
    press("ArrowDown");
    press("j");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("i2");
    // Focus has one card: the row index clamps to it.
    press("ArrowRight");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("f1");
    press("ArrowLeft");
    press("k");
    press("Enter");
    expect(onOpen).toHaveBeenLastCalledWith("i1");
  });

  it("keys typed into a field inside the board are ignored", () => {
    useStore.setState({ tasks: [makeTask("a")] });
    render(<Board />);
    press("ArrowDown");
    const input = document.createElement("input");
    board().appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight", shiftKey: true });
    expect(lifecycleOf("a")).toBe("inbox");
    input.remove();
  });
});

describe("BoardView undo", () => {
  it("Undo restores the previous status, by click", async () => {
    useStore.setState({ tasks: [makeTask("a")] });
    render(<Board />);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(lifecycleOf("a")).toBe("inbox");
    expect(screen.queryByTestId("board-undo")).toBeNull();
  });

  it("Ctrl+Z undoes within the window; a newer move replaces the older one", () => {
    useStore.setState({ tasks: [makeTask("a"), makeTask("b", { lifecycle: "someday" })] });
    render(<Board />);
    press("ArrowDown"); // a, first card of the first non-empty column
    press("ArrowRight", { shiftKey: true }); // a → Focus
    press("ArrowRight"); // Waiting (empty), remembering the row
    press("ArrowRight"); // Someday: b
    press("ArrowRight", { shiftKey: true }); // b → Done
    expect(screen.getByTestId("board-undo")).toHaveTextContent("Moved to Done");
    press("z", { ctrlKey: true });
    expect(lifecycleOf("b")).toBe("someday");
    expect(lifecycleOf("a")).toBe("active");
    press("z", { ctrlKey: true });
    expect(lifecycleOf("a")).toBe("active");
  });

  it("Ctrl+Z after the window does nothing", () => {
    vi.useFakeTimers();
    useStore.setState({ tasks: [makeTask("a")] });
    render(<Board />);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    act(() => {
      vi.advanceTimersByTime(BOARD_UNDO_MS + 10);
    });
    expect(screen.queryByTestId("board-undo")).toBeNull();
    press("z", { ctrlKey: true });
    expect(lifecycleOf("a")).toBe("active");
  });
});
