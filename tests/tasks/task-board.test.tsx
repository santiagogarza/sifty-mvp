/** @vitest-environment jsdom */

import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoard } from "@/components/tasks/task-board";
import { TaskCard } from "@/components/tasks/task-card";
import { STATUSES_IN_ORDER, statusLabel } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { TODAY_BOARD_COLUMNS, droppableId, resolveBoardDrop } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}));

const NOW = new Date("2026-07-22T12:00:00Z");

let seq = 0;
function makeTask(patch: Partial<Task> = {}): Task {
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

function seed(tasks: Task[]) {
  useStore.setState({
    tasks,
    labels: [],
    memories: [],
    hydrated: true,
    viewMode: "board",
  });
}

beforeEach(() => {
  seq = 0;
  useStore.setState({
    tasks: [],
    labels: [],
    memories: [],
    hydrated: true,
    viewMode: "board",
  });
});

describe("TaskBoard", () => {
  it("renders statusLabel() headers — Focus, never Active or In progress", () => {
    seed([]);
    render(
      <TaskBoard tasks={[]} onOpen={vi.fn()} columns={STATUSES_IN_ORDER} allowDropped={false} />,
    );
    expect(screen.getByRole("heading", { name: statusLabel("active") })).toHaveTextContent("Focus");
    expect(screen.queryByRole("heading", { name: "Active" })).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
  });

  it("simulated drop from Focus to Done sets completedAt via updateTask", () => {
    const task = makeTask({ lifecycle: "active", title: "Move me" });
    seed([task]);
    const original = useStore.getState().updateTask;
    const updateTask = vi.fn((...args: Parameters<typeof original>) => original(...args));
    useStore.setState({ updateTask });

    render(<TaskBoard tasks={[task]} onOpen={vi.fn()} />);
    const commit = resolveBoardDrop(task.id, droppableId("done"), useStore.getState().tasks);
    expect(commit).toEqual({ taskId: task.id, lifecycle: "done" });
    useStore.getState().setLifecycle(commit!.taskId, commit!.lifecycle);

    expect(updateTask).toHaveBeenCalledWith(task.id, { lifecycle: "done" });
    expect(useStore.getState().tasks[0]?.completedAt).toBeTruthy();
  });

  it("simulated drop from Done to Focus clears completedAt", () => {
    const task = makeTask({
      lifecycle: "done",
      title: "Reopen me",
      completedAt: NOW.toISOString(),
    });
    seed([task]);
    render(<TaskBoard tasks={[task]} onOpen={vi.fn()} />);
    const commit = resolveBoardDrop(task.id, droppableId("active"), useStore.getState().tasks);
    useStore.getState().setLifecycle(commit!.taskId, commit!.lifecycle);
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    expect(useStore.getState().tasks[0]?.completedAt).toBeNull();
  });

  it("Alt+→ keeps selection on the moved card when it is not first in Focus", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const inbox = makeTask({
      lifecycle: "inbox",
      title: "File me",
      priorityBucket: "schedule",
    });
    const focusTop = makeTask({
      lifecycle: "active",
      title: "Already focused",
      priorityBucket: "do_now",
      importance: 1,
      urgency: 1,
    });
    seed([inbox, focusTop]);
    const { rerender } = render(<TaskBoard tasks={useStore.getState().tasks} onOpen={onOpen} />);

    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(useStore.getState().tasks.find((t) => t.id === inbox.id)?.lifecycle).toBe("active");

    rerender(<TaskBoard tasks={useStore.getState().tasks} onOpen={onOpen} />);
    expect(screen.getByTestId(`task-card-${inbox.id}`)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`task-card-${focusTop.id}`)).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(inbox.id);
  });

  it("keeps selection on the highlighted card after it leaves its old slot", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const first = makeTask({
      lifecycle: "inbox",
      title: "Drag me",
      createdAt: "2026-07-22T12:00:00Z",
    });
    const second = makeTask({
      lifecycle: "inbox",
      title: "Slides up",
      createdAt: "2026-07-21T12:00:00Z",
    });
    seed([first, second]);
    const { rerender } = render(<TaskBoard tasks={useStore.getState().tasks} onOpen={onOpen} />);

    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId(`task-card-${first.id}`)).toHaveAttribute("aria-selected", "true");

    useStore.getState().setLifecycle(first.id, "active");
    rerender(<TaskBoard tasks={useStore.getState().tasks} onOpen={onOpen} />);

    expect(screen.getByTestId(`task-card-${first.id}`)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`task-card-${second.id}`)).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(first.id);
  });

  it("Alt+→ moves the selected card one column and is a no-op at the last visible column", async () => {
    const user = userEvent.setup();
    const task = makeTask({ lifecycle: "inbox", title: "Walk me" });
    seed([task]);
    const { rerender } = render(<TaskBoard tasks={useStore.getState().tasks} onOpen={vi.fn()} />);

    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");

    rerender(<TaskBoard tasks={useStore.getState().tasks} onOpen={vi.fn()} />);
    const done = makeTask({
      lifecycle: "done",
      title: "Already done",
      completedAt: NOW.toISOString(),
    });
    seed([done]);
    rerender(<TaskBoard tasks={[done]} onOpen={vi.fn()} />);
    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}");
    const before = useStore.getState().tasks[0]?.lifecycle;
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(useStore.getState().tasks[0]?.lifecycle).toBe(before);
    expect(before).toBe("done");
  });

  it("does not highlight another card when the selected task leaves the board", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const first = makeTask({
      lifecycle: "inbox",
      title: "Complete me",
      createdAt: "2026-07-22T12:00:00Z",
    });
    const second = makeTask({
      lifecycle: "inbox",
      title: "Stays behind",
      createdAt: "2026-07-21T12:00:00Z",
    });
    seed([first, second]);
    const { rerender } = render(
      <TaskBoard
        tasks={useStore.getState().tasks}
        onOpen={onOpen}
        columns={TODAY_BOARD_COLUMNS}
        allowDropped={false}
      />,
    );

    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId(`task-card-${first.id}`)).toHaveAttribute("aria-selected", "true");

    useStore.getState().setLifecycle(first.id, "done");
    rerender(
      <TaskBoard
        tasks={useStore.getState().tasks.filter((t) => t.lifecycle !== "done")}
        onOpen={onOpen}
        columns={TODAY_BOARD_COLUMNS}
        allowDropped={false}
      />,
    );

    expect(screen.queryByTestId(`task-card-${first.id}`)).toBeNull();
    expect(screen.getByTestId(`task-card-${second.id}`)).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Enter}");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("arrow keys can cross empty columns to reach a later card", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const waiting = makeTask({ lifecycle: "waiting", title: "Only waiting" });
    seed([waiting]);
    render(<TaskBoard tasks={[waiting]} onOpen={onOpen} />);

    await user.click(screen.getByRole("listbox", { name: "Task board" }));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByTestId(`task-card-${waiting.id}`)).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(waiting.id);
  });

  it("board scroller allows vertical and horizontal touch panning", () => {
    seed([]);
    render(<TaskBoard tasks={[]} onOpen={vi.fn()} />);
    expect(screen.getByRole("listbox", { name: "Task board" })).toHaveStyle({
      touchAction: "pan-x pan-y",
    });
  });

  it("zero tasks renders empty columns with no placeholder commentary", () => {
    seed([]);
    render(
      <TaskBoard tasks={[]} onOpen={vi.fn()} columns={STATUSES_IN_ORDER} allowDropped={false} />,
    );
    for (const lifecycle of STATUSES_IN_ORDER) {
      expect(screen.getByTestId(`board-column-${lifecycle}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/nothing/i)).toBeNull();
    expect(screen.queryByText(/drop here/i)).toBeNull();
    expect(screen.queryByText(/empty/i)).toBeNull();
  });

  it("one task renders in the column matching its lifecycle", () => {
    const task = makeTask({ lifecycle: "waiting", title: "Chase invoice" });
    seed([task]);
    render(<TaskBoard tasks={[task]} onOpen={vi.fn()} />);
    const column = screen.getByTestId("board-column-waiting");
    expect(column).toHaveTextContent("Chase invoice");
    expect(screen.getByTestId("board-column-inbox")).not.toHaveTextContent("Chase invoice");
  });
});

describe("TaskCard click vs drag", () => {
  it("a click that moves under 5px opens detail; over 5px does not", () => {
    const task = makeTask({ title: "Click me" });
    const onOpen = vi.fn();
    render(
      <DndContext>
        <TaskCard task={task} labels={[]} onOpen={onOpen} onComplete={vi.fn()} />
      </DndContext>,
    );
    const card = screen.getByTestId(`task-card-${task.id}`);

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { clientX: 12, clientY: 12 });
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(task.id);

    onOpen.mockClear();
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card, { clientX: 20, clientY: 10 });
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
