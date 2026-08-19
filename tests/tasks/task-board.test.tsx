// @vitest-environment jsdom
import { TaskBoard } from "@/components/tasks/task-board";
import { STATUSES_IN_ORDER, statusLabel } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTask } from "../helpers/tasks";

/**
 * Board component contract, driven through the real dnd-kit pipeline where
 * it matters (sensor activation, collision, drop) and through the real
 * store for every mutation.
 *
 * jsdom shims: no layout engine, so column rects are stubbed per element
 * for collision detection, and observers/scroll APIs are no-op'd.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // Spies attached to store actions get copied into every new state object
  // zustand creates, so clear call history rather than trying to restore.
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = () => {};
  useStore.setState({ tasks: [], labels: [] });
});

// An activated drag attaches a capture-phase click suppressor to the
// document that dnd-kit removes on a 50ms timeout after the drag ends.
// Tests share one jsdom document, so let that window lapse between them.
afterEach(() => new Promise((resolve) => setTimeout(resolve, 60)));

function renderBoard(tasks: Task[]) {
  useStore.setState({ tasks });
  const onOpen = vi.fn();
  const utils = render(<TaskBoard onOpen={onOpen} />);
  return { onOpen, ...utils };
}

function stubRect(el: Element, rect: { x: number; y: number; width: number; height: number }) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Lay the rendered columns out left-to-right so pointer collision works. */
function layoutColumns() {
  const columns = screen.getAllByRole("group");
  columns.forEach((el, i) => stubRect(el, { x: i * 260, y: 0, width: 248, height: 600 }));
  return columns;
}

function columnCenterX(lifecycle: string): number {
  const index = screen
    .getAllByRole("group")
    .findIndex(
      (el) => el.getAttribute("aria-label") === `${statusLabel(lifecycle as never)} column`,
    );
  return index * 260 + 124;
}

/** Drag a card through real mouse events: down → activate → target → up. */
function dragCard(card: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.mouseDown(card, { clientX: from.x, clientY: from.y, button: 0 });
  // First move crosses the 5px activation distance, second lands on target.
  fireEvent.mouseMove(document, { clientX: from.x + 10, clientY: from.y });
  fireEvent.mouseMove(document, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(document, { clientX: to.x, clientY: to.y });
}

function storeTask(id: string): Task {
  const task = useStore.getState().tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task ${id} not in store`);
  return task;
}

describe("column headers", () => {
  it("render statusLabel() output — Focus, never Active/In progress/Backlog", () => {
    renderBoard([makeTask({ lifecycle: "active", title: "Ship the board" })]);

    expect(screen.getByRole("group", { name: "Focus column" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Focus column" })).getByText("Focus"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.queryByText("Backlog")).toBeNull();
  });
});

describe("column structure", () => {
  it("renders every pipeline column empty with no visible commentary, and the disclosure reveals the sixth", () => {
    renderBoard([]);

    const pipeline = STATUSES_IN_ORDER.filter((s) => s !== "dropped");
    for (const lifecycle of pipeline) {
      const column = screen.getByRole("group", { name: `${statusLabel(lifecycle)} column` });
      expect(within(column).queryAllByRole("option")).toHaveLength(0);
    }
    expect(screen.getAllByRole("group")).toHaveLength(pipeline.length);
    // The only in-column placeholder is the drag-time drop hint, hidden
    // from the accessibility tree and invisible until a drag starts.
    for (const hint of screen.getAllByText("Drop here")) {
      expect(hint).toHaveAttribute("aria-hidden", "true");
      expect(hint.className).toContain("opacity-0");
    }

    fireEvent.click(screen.getByRole("button", { name: /show dropped/i }));
    expect(screen.getAllByRole("group")).toHaveLength(STATUSES_IN_ORDER.length);
    expect(screen.getByRole("group", { name: "Dropped column" })).toBeInTheDocument();
  });

  it("renders a task in exactly the column matching its lifecycle", () => {
    renderBoard([makeTask({ lifecycle: "waiting", title: "Chase the vendor" })]);

    const waiting = screen.getByRole("group", { name: "Waiting on column" });
    expect(within(waiting).getByText("Chase the vendor")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("keeps the Dropped column and its cards behind the disclosure", () => {
    renderBoard([makeTask({ lifecycle: "dropped", title: "Old idea" })]);

    expect(screen.queryByRole("group", { name: "Dropped column" })).toBeNull();
    expect(screen.queryByText("Old idea")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show dropped/i }));
    const dropped = screen.getByRole("group", { name: "Dropped column" });
    expect(within(dropped).getByText("Old idea")).toBeInTheDocument();
  });
});

describe("drag and drop", () => {
  it("commits a Focus → Done drop through updateTask and stamps completedAt", () => {
    const task = makeTask({ lifecycle: "active", title: "Finish the report" });
    renderBoard([task]);
    layoutColumns();
    const updateTask = vi.spyOn(useStore.getState(), "updateTask");

    dragCard(
      screen.getByRole("option"),
      { x: columnCenterX("active"), y: 60 },
      {
        x: columnCenterX("done"),
        y: 60,
      },
    );

    expect(updateTask).toHaveBeenCalledWith(task.id, { lifecycle: "done" });
    expect(storeTask(task.id).lifecycle).toBe("done");
    expect(storeTask(task.id).completedAt).not.toBeNull();
  });

  it("clears completedAt when a Done card is dragged back to Focus", () => {
    const task = makeTask({
      lifecycle: "done",
      title: "Rethink the plan",
      completedAt: new Date().toISOString(),
    });
    renderBoard([task]);
    layoutColumns();

    dragCard(
      screen.getByRole("option"),
      { x: columnCenterX("done"), y: 60 },
      {
        x: columnCenterX("active"),
        y: 60,
      },
    );

    expect(storeTask(task.id).lifecycle).toBe("active");
    expect(storeTask(task.id).completedAt).toBeNull();
  });

  it("treats a drop back into the card's own column as a no-op", () => {
    const task = makeTask({ lifecycle: "active", title: "Stay put" });
    renderBoard([task]);
    layoutColumns();
    const updateTask = vi.spyOn(useStore.getState(), "updateTask");
    const before = storeTask(task.id);

    dragCard(
      screen.getByRole("option"),
      { x: columnCenterX("active"), y: 60 },
      {
        x: columnCenterX("active"),
        y: 200,
      },
    );

    expect(updateTask).not.toHaveBeenCalled();
    // Not even a touch: the store object is untouched, so nothing syncs.
    expect(storeTask(task.id)).toBe(before);
  });
});

describe("click vs drag", () => {
  it("opens the detail sheet for a click that moves under the 5px activation distance", () => {
    const task = makeTask({ lifecycle: "active", title: "Open me" });
    const { onOpen } = renderBoard([task]);
    const card = screen.getByRole("option");

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.mouseDown(card, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(document, { clientX: 12, clientY: 11 });
    fireEvent.mouseUp(document, { clientX: 12, clientY: 11 });
    fireEvent.click(card, { clientX: 12, clientY: 11 });

    expect(onOpen).toHaveBeenCalledWith(task.id);
  });

  it("does not open the detail sheet when the press travels past the activation distance", () => {
    const task = makeTask({ lifecycle: "active", title: "Drag me" });
    const { onOpen } = renderBoard([task]);
    layoutColumns();
    const card = screen.getByRole("option");

    fireEvent.pointerDown(card, { clientX: 10, clientY: 10 });
    fireEvent.mouseDown(card, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 10 });
    // Validity check: the drag really activated — the overlay clone exists.
    expect(screen.getAllByText("Drag me").length).toBeGreaterThan(1);
    fireEvent.mouseUp(document, { clientX: 40, clientY: 10 });
    fireEvent.click(card, { clientX: 40, clientY: 10 });

    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("keyboard model", () => {
  function boardListbox(): HTMLElement {
    return screen.getByRole("listbox", { name: "Task board" });
  }

  it("Alt+ArrowRight advances the selected card exactly one column, stopping at the last visible one", () => {
    const task = makeTask({ lifecycle: "inbox", title: "March me across" });
    renderBoard([task]);
    const board = boardListbox();

    fireEvent.keyDown(board, { key: "ArrowDown" });
    expect(screen.getByRole("option")).toHaveAttribute("aria-selected", "true");

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
      seen.push(storeTask(task.id).lifecycle);
    }
    // One column per press along STATUSES_IN_ORDER; Dropped is hidden, so
    // Done is the last visible column and the fifth press is a no-op.
    expect(seen).toEqual(["active", "waiting", "someday", "done", "done"]);
    expect(storeTask(task.id).completedAt).not.toBeNull();

    fireEvent.keyDown(board, { key: "ArrowLeft", altKey: true });
    expect(storeTask(task.id).lifecycle).toBe("someday");
    expect(storeTask(task.id).completedAt).toBeNull();
  });

  it("moves the card into Dropped only when the disclosure has revealed the column", () => {
    const task = makeTask({ lifecycle: "done", title: "Let me go" });
    renderBoard([task]);
    const board = boardListbox();

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(storeTask(task.id).lifecycle).toBe("done");

    fireEvent.click(screen.getByRole("button", { name: /show dropped/i }));
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(storeTask(task.id).lifecycle).toBe("dropped");
  });

  it("navigates selection with arrows and opens the selected card with Enter", () => {
    const first = makeTask({
      lifecycle: "inbox",
      title: "First",
      createdAt: "2026-07-22T10:00:00Z",
    });
    const second = makeTask({
      lifecycle: "inbox",
      title: "Second",
      createdAt: "2026-07-22T09:00:00Z",
    });
    const focus = makeTask({ lifecycle: "active", title: "Focused" });
    const { onOpen } = renderBoard([first, second, focus]);
    const board = boardListbox();

    fireEvent.keyDown(board, { key: "ArrowDown" });
    fireEvent.keyDown(board, { key: "ArrowDown" });
    expect(
      within(screen.getByRole("group", { name: "Inbox column" })).getAllByRole("option")[1],
    ).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(board, { key: "ArrowRight" });
    fireEvent.keyDown(board, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(focus.id);
  });
});
