// @vitest-environment jsdom

import { BoardView } from "@/components/tasks/board-view";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/task";

function Harness({
  onOpen,
  onAdd,
}: {
  onOpen: (id: string) => void;
  onAdd?: (lifecycle: Lifecycle) => void;
}) {
  const tasks = useStore((s) => s.tasks);
  return <BoardView tasks={tasks} onOpen={onOpen} onAdd={onAdd} />;
}

function seed(tasks: Task[]) {
  useStore.setState({ tasks, labels: [], hydrated: true });
}

function spyLifecycle() {
  const original = useStore.getState().setLifecycle;
  const calls: Array<[string, Lifecycle]> = [];
  useStore.setState({
    setLifecycle: (id: string, lifecycle: Lifecycle) => {
      calls.push([id, lifecycle]);
      original(id, lifecycle);
    },
  });
  return calls;
}

describe("BoardView", () => {
  beforeEach(() => {
    seed([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders five silent columns when there is nothing to file", () => {
    render(<Harness onOpen={vi.fn()} />);
    for (const name of ["Inbox, 0", "Focus, 0", "Waiting on, 0", "Someday, 0", "Done, 0"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: /Dropped/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /Today/ })).toBeNull();
    expect(screen.queryByText(/nothing/i)).toBeNull();
    expect(screen.queryByText("to move")).toBeNull();
  });

  it("files the selected inbox card one column to the right", () => {
    const task = makeTask({ id: "task_file", title: "File me", lifecycle: "inbox" });
    seed([task]);
    const calls = spyLifecycle();
    render(<Harness onOpen={vi.fn()} />);

    const board = screen.getByRole("listbox", { name: "Board" });
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(calls).toEqual([["task_file", "active"]]);
    expect(screen.getByText("Moved to Focus")).toBeInTheDocument();
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });

  it("does not file a card past Done", () => {
    seed([makeTask({ id: "task_done", title: "Finished", lifecycle: "done" })]);
    const calls = spyLifecycle();
    render(<Harness onOpen={vi.fn()} />);

    const board = screen.getByRole("listbox", { name: "Board" });
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(board, { key: "ArrowRight" });
    }
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(calls).toEqual([]);
    expect(screen.queryByText(/Moved to/)).toBeNull();
  });

  it("opens the selected card on Enter and a click that did not drag", async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: "task_open", title: "Open me", lifecycle: "inbox" });
    seed([task]);
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    const board = screen.getByRole("listbox", { name: "Board" });
    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("task_open");

    await user.click(screen.getByText("Open me"));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("adds into the column that was clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<Harness onOpen={vi.fn()} onAdd={onAdd} />);
    const waiting = screen.getByRole("region", { name: "Waiting on, 0" });
    await user.click(within(waiting).getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("waiting");
  });

  it("restores the lifecycle this session completed from", async () => {
    const user = userEvent.setup();
    seed([makeTask({ id: "task_check", title: "Check me", lifecycle: "waiting" })]);
    render(<Harness onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
    expect(useStore.getState().tasks[0]?.completedAt).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mark as not done" }));
    const restored = useStore.getState().tasks[0];
    expect(restored?.lifecycle).toBe("waiting");
    expect(restored?.completedAt).toBeNull();
  });
});

describe("BoardView undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seed([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("undoes by click and by Ctrl+Z, then expires", () => {
    seed([makeTask({ id: "task_undo", title: "Undo me", lifecycle: "inbox" })]);
    render(<Harness onOpen={vi.fn()} />);
    const board = screen.getByRole("listbox", { name: "Board" });

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");
    expect(screen.queryByText("Moved to Focus")).toBeNull();

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("inbox");

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });

  it("replaces the previous undo when the card is filed again", () => {
    seed([makeTask({ id: "task_replace", title: "Replace me", lifecycle: "inbox" })]);
    render(<Harness onOpen={vi.fn()} />);
    const board = screen.getByRole("listbox", { name: "Board" });

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(board, { key: "ArrowRight", shiftKey: true });

    expect(useStore.getState().tasks[0]?.lifecycle).toBe("waiting");
    expect(screen.getByText("Moved to Waiting on")).toBeInTheDocument();

    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");
  });
});
