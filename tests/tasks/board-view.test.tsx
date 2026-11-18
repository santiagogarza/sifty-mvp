// @vitest-environment jsdom

import DonePage from "@/app/(app)/done/page";
import { BoardView } from "@/components/tasks/board-view";
import { TaskView } from "@/components/tasks/task-view";
import { setViewMode } from "@/components/tasks/use-view-mode";
import type { Task } from "@/lib/domain/types";
import type { Lifecycle } from "@/lib/domain/types";
import { selectInboxTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openDetail = vi.hoisted(() => vi.fn());
const openCapture = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-shell/app-frame", () => ({
  useFrame: () => ({
    openDetail,
    openCapture,
    openCommand: vi.fn(),
    syncError: false,
  }),
}));

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: "task_board_1",
    sourceText: "Draft the note",
    sourceContext: null,
    title: "Draft the note",
    description: null,
    nextAction: "Open the doc",
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
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z",
    completedAt: null,
    ...patch,
  };
}

function ConnectedBoard({
  onOpen,
  onAdd = () => {},
}: {
  onOpen: (id: string) => void;
  onAdd?: (lifecycle: Lifecycle) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} onAdd={onAdd} />;
}

function renderBoard(tasks: Task[], onOpen = vi.fn(), onAdd = vi.fn()) {
  useStore.setState({ tasks, labels: [], hydrated: true });
  return render(<ConnectedBoard onOpen={onOpen} onAdd={onAdd} />);
}

describe("BoardView", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewMode("list");
    openDetail.mockClear();
    openCapture.mockClear();
    useStore.setState({ tasks: [], labels: [], hydrated: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the five status columns and no Dropped or Today column", () => {
    renderBoard([makeTask()]);
    expect(screen.getByRole("region", { name: "Inbox, 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focus, 0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Waiting on, 0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Someday, 0" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Done, 0" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Dropped/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Today/ })).toBeNull();
  });

  it("shows silent columns and no hint when nothing is filed", () => {
    renderBoard([]);
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.queryByText(/nothing here/i)).toBeNull();
    expect(screen.queryByText(/to file/)).toBeNull();
  });

  it("files the selected inbox card one column to the right", () => {
    const task = makeTask();
    renderBoard([task]);
    const board = screen.getByTestId("board");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    expect(screen.getByText("Moved to Focus")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Focus, 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Inbox, 0" })).toBeInTheDocument();
  });

  it("keeps focus after a keyboard move so the next file and undo still run", async () => {
    const user = userEvent.setup();
    renderBoard([makeTask()]);
    await waitFor(() => expect(screen.getByTestId("board")).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");

    await user.keyboard("{Control>}z{/Control}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    expect(screen.getByRole("article", { name: "Draft the note" })).toHaveFocus();
  });

  it("does not file a Done card past the last column", () => {
    const task = makeTask({
      id: "task_done",
      lifecycle: "done",
      completedAt: "2026-07-22T12:00:00.000Z",
    });
    renderBoard([task]);
    const board = screen.getByTestId("board");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(screen.queryByText(/Moved to/)).toBeNull();
  });

  it("opens the selected card on Enter and a click that did not drag", async () => {
    const task = makeTask();
    const onOpen = vi.fn();
    renderBoard([task], onOpen);
    const board = screen.getByTestId("board");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(task.id);

    const user = userEvent.setup();
    await user.click(screen.getByText(task.title));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("undoes from the pill and from Ctrl+Z, then ignores Ctrl+Z after the pill retires", () => {
    vi.useFakeTimers();
    const task = makeTask();
    renderBoard([task]);
    const board = screen.getByTestId("board");
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");
    expect(useStore.getState().tasks[0]?.completedAt).toBeNull();

    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");

    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText(/Moved to/)).toBeNull();
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });

  it("restores the lifecycle a card had before it was completed from the board", () => {
    const task = makeTask({ lifecycle: "waiting" });
    renderBoard([task]);
    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(useStore.getState().tasks[0]?.completedAt).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mark as not done" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");
    expect(useStore.getState().tasks[0]?.completedAt).toBeNull();
  });

  it("asks capture to file into the column that was added to", () => {
    const onAdd = vi.fn();
    renderBoard([], vi.fn(), onAdd);
    fireEvent.click(screen.getByRole("button", { name: "Add to Focus" }));
    expect(onAdd).toHaveBeenCalledWith("active");
  });

  it("renders a few hundred cards without dropping the column", () => {
    const tasks = Array.from({ length: 200 }, (_, index) =>
      makeTask({
        id: `task_bulk_${index}`,
        title: `Bulk ${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      }),
    );
    renderBoard(tasks);
    expect(screen.getByRole("region", { name: "Inbox, 200" })).toBeInTheDocument();
    expect(screen.getByText("Bulk 0")).toBeInTheDocument();
    expect(screen.getByText("Bulk 199")).toBeInTheDocument();
  });
});

describe("TaskView layout toggle", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewMode("list");
    useStore.setState({ tasks: [makeTask()], labels: [], hydrated: true });
  });

  it("swaps the header copy and shows five columns", () => {
    render(
      <TaskView
        title="Inbox"
        description="Newly captured tasks."
        selector={selectInboxTasks}
        emptyTitle="Inbox zero."
      />,
    );

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Inbox, / })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Board" }));

    expect(screen.getByRole("heading", { name: "Everything, by status" })).toBeInTheDocument();
    expect(screen.getByText(/Drag a card to another column/)).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.queryByText("Inbox zero.")).toBeNull();
  });
});

describe("Done page", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewMode("list");
    useStore.setState({
      tasks: [
        makeTask({ id: "task_done", lifecycle: "done", completedAt: "2026-07-22T12:00:00.000Z" }),
        makeTask({ id: "task_dropped", title: "Let it go", lifecycle: "dropped" }),
      ],
      labels: [],
      hydrated: true,
    });
  });

  it("hides the Dropped disclosure in Board and brings it back in List", () => {
    render(<DonePage />);
    expect(screen.getByRole("button", { name: /Dropped/ })).toBeInTheDocument();

    act(() => setViewMode("board"));
    expect(screen.queryByRole("button", { name: /Dropped/ })).toBeNull();
    expect(screen.queryByText("Let it go")).toBeNull();

    act(() => setViewMode("list"));
    expect(screen.getByRole("button", { name: /Dropped/ })).toBeInTheDocument();
  });
});
