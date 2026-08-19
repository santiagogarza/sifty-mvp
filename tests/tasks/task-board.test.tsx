import { TaskBoard, handleBoardDragEnd, resolveColumnMove } from "@/components/tasks/task-board";
import { TaskCard } from "@/components/tasks/task-card";
import type { Task } from "@/lib/domain/types";
import { DEFAULT_BOARD_COLUMNS } from "@/lib/store/board";
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
