import { TaskBoard, handleBoardDragEnd, resolveColumnMove } from "@/components/tasks/task-board";
import { TaskCard } from "@/components/tasks/task-card";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { DEFAULT_BOARD_COLUMNS, TODAY_BOARD_COLUMNS } from "@/lib/store/board";
import { isTodayTask } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
function makeTask(patch: Partial<Task>): Task {
  seq += 1;
  return {
    id: `task_ui_${seq}`,
    sourceText: "test",
    sourceContext: null,
    title: patch.title ?? `Task ${seq}`,
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
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: null,
    ...patch,
  };
}

function LiveBoard({
  columns,
  onOpen,
  taskFilter,
  highlightColumn,
}: {
  columns: readonly Lifecycle[];
  onOpen: (id: string) => void;
  taskFilter?: (task: Task, now: Date) => boolean;
  highlightColumn?: Lifecycle;
}) {
  const tasks = useStore((s) => s.tasks);
  return (
    <TaskBoard
      tasks={tasks}
      columns={columns}
      onOpen={onOpen}
      taskFilter={taskFilter}
      highlightColumn={highlightColumn}
    />
  );
}

function seedStore(tasks: Task[]) {
  useStore.setState({
    hydrated: true,
    tasks,
    labels: [],
    memories: [],
    preferredModelId: useStore.getState().preferredModelId,
    viewMode: "board",
  });
}

describe("TaskBoard", () => {
  beforeEach(() => {
    seq = 0;
    useStore.setState({
      hydrated: true,
      tasks: [],
      labels: [],
      memories: [],
      viewMode: "list",
    });
  });

  it('renders "Focus" for the active column header, not "Active"', () => {
    seedStore([makeTask({ lifecycle: "active", title: "Deep work" })]);
    render(
      <TaskBoard
        tasks={useStore.getState().tasks}
        columns={DEFAULT_BOARD_COLUMNS}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("In progress")).not.toBeInTheDocument();
  });

  it("simulated drop from Focus to Done sets lifecycle and completedAt", () => {
    const task = makeTask({ lifecycle: "active", title: "Ship feature" });
    seedStore([task]);
    const setLifecycle = useStore.getState().setLifecycle;

    handleBoardDragEnd(
      { active: { id: task.id }, over: { id: "done" } },
      [task],
      DEFAULT_BOARD_COLUMNS,
      setLifecycle,
    );

    const updated = useStore.getState().tasks[0]!;
    expect(updated.lifecycle).toBe("done");
    expect(updated.completedAt).toBeTruthy();
  });

  it("simulated drop from Done to Focus clears completedAt", () => {
    const task = makeTask({
      lifecycle: "done",
      title: "Finished item",
      completedAt: NOW.toISOString(),
    });
    seedStore([task]);
    const setLifecycle = useStore.getState().setLifecycle;

    handleBoardDragEnd(
      { active: { id: task.id }, over: { id: "active" } },
      [task],
      DEFAULT_BOARD_COLUMNS,
      setLifecycle,
    );

    const updated = useStore.getState().tasks[0]!;
    expect(updated.lifecycle).toBe("active");
    expect(updated.completedAt).toBeNull();
  });

  it("Alt+ArrowRight moves the selected card one column and is a no-op at the last column", () => {
    const task = makeTask({ lifecycle: "someday", title: "Later idea" });
    seedStore([task]);
    render(
      <TaskBoard
        tasks={useStore.getState().tasks}
        columns={DEFAULT_BOARD_COLUMNS}
        onOpen={vi.fn()}
        highlightColumn="someday"
      />,
    );

    const board = screen.getByRole("listbox", { name: "Task board" });
    board.focus();

    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("done");

    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("done");
  });

  it("keeps selection on the card moved with Alt+Arrow after the destination re-sorts", () => {
    const incoming = makeTask({
      lifecycle: "inbox",
      title: "Incoming low priority",
      priorityBucket: "drop",
    });
    const urgent = makeTask({
      lifecycle: "active",
      title: "Already urgent",
      priorityBucket: "do_now",
    });
    seedStore([incoming, urgent]);
    const onOpen = vi.fn();
    render(<LiveBoard columns={DEFAULT_BOARD_COLUMNS} onOpen={onOpen} />);

    const board = screen.getByRole("listbox", { name: "Task board" });
    board.focus();
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });

    expect(useStore.getState().tasks.find((t) => t.id === incoming.id)!.lifecycle).toBe("active");

    fireEvent.keyDown(board, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(incoming.id);
  });

  it("does not hide a due-less do_now Today card that would leave the Today filter", () => {
    const task = makeTask({
      lifecycle: "inbox",
      title: "Urgent today",
      priorityBucket: "do_now",
    });
    seedStore([task]);
    render(<LiveBoard columns={TODAY_BOARD_COLUMNS} taskFilter={isTodayTask} onOpen={vi.fn()} />);

    const board = screen.getByRole("listbox", { name: "Task board" });
    board.focus();
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("active");
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("active");
    expect(screen.getByText("Urgent today")).toBeInTheDocument();
  });

  it("keeps a completed Today card visible as a completion ghost", () => {
    const task = makeTask({
      lifecycle: "active",
      title: "Finish this",
      priorityBucket: "do_now",
    });
    seedStore([task]);
    render(
      <LiveBoard
        columns={TODAY_BOARD_COLUMNS}
        taskFilter={isTodayTask}
        onOpen={vi.fn()}
        highlightColumn="active"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("done");
    expect(screen.getByText("Finish this")).toBeInTheDocument();
  });

  it("keeps a completed Today card in its original column spot as a ghost", () => {
    const newer = makeTask({
      lifecycle: "inbox",
      title: "Newer today",
      priorityBucket: "do_now",
      createdAt: "2026-07-22T13:00:00Z",
    });
    const older = makeTask({
      lifecycle: "inbox",
      title: "Older today",
      priorityBucket: "do_now",
      createdAt: "2026-07-22T11:00:00Z",
    });
    seedStore([newer, older]);
    render(<LiveBoard columns={TODAY_BOARD_COLUMNS} taskFilter={isTodayTask} onOpen={vi.fn()} />);

    const inbox = screen.getByLabelText("Inbox");
    const titles = () =>
      within(inbox)
        .getAllByRole("option")
        .map((el) => el.textContent);

    expect(titles()[0]).toContain("Newer today");
    expect(titles()[1]).toContain("Older today");

    fireEvent.click(within(inbox).getAllByRole("button", { name: "Mark as done" })[0]!);

    expect(useStore.getState().tasks.find((t) => t.id === newer.id)!.lifecycle).toBe("done");
    expect(titles()[0]).toContain("Newer today");
    expect(titles()[1]).toContain("Older today");
  });

  it("keeps sequential completion ghosts in the column order the user just saw", () => {
    const first = makeTask({
      lifecycle: "inbox",
      title: "First today",
      priorityBucket: "do_now",
      createdAt: "2026-07-22T13:00:00Z",
    });
    const second = makeTask({
      lifecycle: "inbox",
      title: "Second today",
      priorityBucket: "do_now",
      createdAt: "2026-07-22T12:00:00Z",
    });
    const third = makeTask({
      lifecycle: "inbox",
      title: "Third today",
      priorityBucket: "do_now",
      createdAt: "2026-07-22T11:00:00Z",
    });
    seedStore([first, second, third]);
    render(<LiveBoard columns={TODAY_BOARD_COLUMNS} taskFilter={isTodayTask} onOpen={vi.fn()} />);

    const inbox = screen.getByLabelText("Inbox");
    const titles = () =>
      within(inbox)
        .getAllByRole("option")
        .map((el) => el.textContent);

    expect(titles()[0]).toContain("First today");
    expect(titles()[1]).toContain("Second today");
    expect(titles()[2]).toContain("Third today");

    fireEvent.click(within(inbox).getAllByRole("button", { name: "Mark as done" })[0]!);
    fireEvent.click(within(inbox).getAllByRole("button", { name: "Mark as done" })[0]!);

    expect(titles()[0]).toContain("First today");
    expect(titles()[1]).toContain("Second today");
    expect(titles()[2]).toContain("Third today");
  });

  it("rejects a Today-filter drop that would hide the card", () => {
    const task = makeTask({
      lifecycle: "active",
      title: "Stay visible",
      priorityBucket: "do_now",
    });
    seedStore([task]);
    handleBoardDragEnd(
      { active: { id: task.id }, over: { id: "waiting" } },
      [task],
      TODAY_BOARD_COLUMNS,
      useStore.getState().setLifecycle,
      isTodayTask,
    );
    expect(useStore.getState().tasks[0]!.lifecycle).toBe("active");
  });

  it("renders six empty columns with zero tasks and places one task in the right column", () => {
    seedStore([]);
    const { rerender } = render(
      <TaskBoard tasks={[]} columns={DEFAULT_BOARD_COLUMNS} onOpen={vi.fn()} />,
    );

    for (const name of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByText(/no tasks/i)).not.toBeInTheDocument();

    const waiting = makeTask({ lifecycle: "waiting", title: "Blocked item" });
    seedStore([waiting]);
    rerender(<TaskBoard tasks={[waiting]} columns={DEFAULT_BOARD_COLUMNS} onOpen={vi.fn()} />);

    const waitingCol = screen.getByLabelText("Waiting on");
    expect(within(waitingCol).getByText("Blocked item")).toBeInTheDocument();
  });
});

describe("resolveColumnMove", () => {
  it("advances exactly one column in order", () => {
    expect(resolveColumnMove("active", DEFAULT_BOARD_COLUMNS, 1)).toBe("waiting");
    expect(resolveColumnMove("done", DEFAULT_BOARD_COLUMNS, 1)).toBeNull();
  });
});

describe("TaskCard click vs drag", () => {
  it("renders a drag overlay without a DndContext (no useDraggable)", () => {
    const task = makeTask({ lifecycle: "inbox", title: "Overlay clone" });
    seedStore([task]);
    render(<TaskCard task={task} labels={[]} onOpen={vi.fn()} isDragOverlay />);
    expect(screen.getByText("Overlay clone")).toBeInTheDocument();
  });

  it("renders a non-draggable ghost card without a DndContext (no useDraggable)", () => {
    const task = makeTask({ lifecycle: "done", title: "Ghost clone" });
    seedStore([task]);
    render(<TaskCard task={task} labels={[]} onOpen={vi.fn()} draggable={false} />);
    expect(screen.getByText("Ghost clone")).toBeInTheDocument();
  });

  it("opens detail on a plain click", () => {
    const onOpen = vi.fn();
    const task = makeTask({ lifecycle: "inbox", title: "Click me" });
    seedStore([task]);

    render(
      <DndContext>
        <TaskCard task={task} labels={[]} onOpen={onOpen} />
      </DndContext>,
    );
    fireEvent.click(screen.getByText("Click me"));
    expect(onOpen).toHaveBeenCalledWith(task.id);
  });
});
