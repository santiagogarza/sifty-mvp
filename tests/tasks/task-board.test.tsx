// @vitest-environment jsdom

import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dnd = vi.hoisted(() => ({
  context: null as Record<string, (...args: never[]) => void> | null,
}));

vi.mock("@dnd-kit/core", () => ({
  closestCorners: vi.fn(),
  DndContext: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    dnd.context = props as Record<string, (...args: never[]) => void>;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class PointerSensor {},
  TouchSensor: class TouchSensor {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  })),
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
}));

import { TaskBoard } from "@/components/tasks/task-board";

const NOW = "2026-08-18T12:00:00.000Z";

let sequence = 0;
function makeTask(patch: Partial<Task> = {}): Task {
  sequence += 1;
  return {
    id: `component_task_${sequence}`,
    sourceText: "source",
    sourceContext: null,
    title: `Task ${sequence}`,
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
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...patch,
  };
}

function renderBoard(tasks: Task[], onOpen = vi.fn()) {
  useStore.setState({ tasks, labels: [], hydrated: true, viewMode: "board" });
  const view = render(<TaskBoard tasks={tasks} onOpen={onOpen} />);
  return { ...view, onOpen };
}

beforeEach(() => {
  dnd.context = null;
  sequence = 0;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("TaskBoard", () => {
  it("renders status metadata and progressively discloses Dropped", () => {
    renderBoard([]);

    expect(screen.getByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Active" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-board-column]")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: /show dropped/i }));
    expect(screen.getByRole("heading", { name: "Dropped" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-board-column]")).toHaveLength(6);
  });

  it("moves a task into and out of Done through the store lifecycle path", () => {
    const task = makeTask({ lifecycle: "active" });
    renderBoard([task]);

    act(() => {
      dnd.context?.onDragEnd({
        active: { id: task.id },
        over: { id: "done" },
      } as never);
    });
    expect(useStore.getState().tasks[0]).toMatchObject({
      lifecycle: "done",
    });
    expect(useStore.getState().tasks[0]?.completedAt).not.toBeNull();

    act(() => {
      dnd.context?.onDragEnd({
        active: { id: task.id },
        over: { id: "active" },
      } as never);
    });
    expect(useStore.getState().tasks[0]).toMatchObject({
      lifecycle: "active",
      completedAt: null,
    });
  });

  it("moves the selected task one visible column with Alt+Arrow", () => {
    const task = makeTask({ lifecycle: "inbox" });
    renderBoard([task]);
    const board = screen.getByRole("listbox", { name: "Task board" });

    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("active");

    useStore.getState().setLifecycle(task.id, "done");
    fireEvent.keyDown(board, { key: "ArrowRight", altKey: true });
    expect(useStore.getState().tasks[0]?.lifecycle).toBe("done");
  });

  it("opens on a short click and suppresses a moved pointer click", () => {
    const task = makeTask();
    const { onOpen } = renderBoard([task]);
    const card = screen.getByRole("option", { name: task.title });

    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(card, { clientX: 3, clientY: 0 });
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(task.id);

    onOpen.mockClear();
    fireEvent.pointerDown(card, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(card, { clientX: 6, clientY: 0 });
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders one task only in its lifecycle column", () => {
    const task = makeTask({ lifecycle: "waiting", title: "Waiting card" });
    renderBoard([task]);

    const waiting = screen.getByRole("group", { name: "Waiting on" });
    expect(within(waiting).getByText("Waiting card")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
