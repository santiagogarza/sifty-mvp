"use client";

import { STATUS_META, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import type { BoardColumn as BoardColumnData } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { DRAG_ACTIVATION_DISTANCE, TaskCard } from "./task-card";

/**
 * The board.
 *
 * Columns are statuses, and dropping a card is the same edit the Status picker
 * makes — `updateTask({ lifecycle })` — so `completedAt`, `editedFields`, and
 * the background sync all behave exactly as they do everywhere else. The board
 * adds a gesture, not a second way to write a task.
 *
 * Ordering inside a column is the list's ordering, so a card dropped onto a
 * different slot in the column it already occupies is intentionally inert.
 */
export function TaskBoard({
  columns,
  droppedColumn,
  onOpen,
  emphasisStatus = null,
  keepsTask,
}: {
  columns: BoardColumnData[];
  /** Supplied when this board offers the Dropped disclosure. */
  droppedColumn?: BoardColumnData | null;
  onOpen: (id: string) => void;
  emphasisStatus?: Lifecycle | null;
  /** Refuse a move that would take the task off this board (Today's lens). */
  keepsTask?: (task: Task, next: Lifecycle) => boolean;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const [showDropped, setShowDropped] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const visible = React.useMemo(
    () => (droppedColumn && showDropped ? [...columns, droppedColumn] : columns),
    [columns, droppedColumn, showDropped],
  );

  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const registerRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  // Focus is moved only in response to a keyboard action, never as a side
  // effect of the store changing — otherwise a background sync would yank the
  // caret out from under someone reading a different column.
  const focusWanted = React.useRef(false);
  React.useEffect(() => {
    if (!focusWanted.current) return;
    focusWanted.current = false;
    if (selectedId) cardRefs.current.get(selectedId)?.focus();
  });

  const taskById = React.useMemo(() => {
    const map = new Map<string, Task>();
    for (const column of visible) for (const task of column.tasks) map.set(task.id, task);
    return map;
  }, [visible]);

  // Selection survives a card moving between columns because it is tracked by
  // task id, not by grid position.
  const locate = React.useCallback(
    (id: string | null): { col: number; row: number } | null => {
      if (!id) return null;
      for (let col = 0; col < visible.length; col++) {
        const row = visible[col]?.tasks.findIndex((t) => t.id === id) ?? -1;
        if (row >= 0) return { col, row };
      }
      return null;
    },
    [visible],
  );

  const select = (id: string | undefined) => {
    if (!id) return;
    focusWanted.current = true;
    setSelectedId(id);
  };

  const firstCardId = (): string | undefined =>
    visible.find((c) => c.tasks.length > 0)?.tasks[0]?.id;

  // Roving tabindex: exactly one card is tabbable, so the board is a single
  // stop in the tab order rather than one per card or one per column.
  const focusableId = (selectedId && locate(selectedId) ? selectedId : firstCardId()) ?? null;

  /** Step sideways, skipping columns that have nothing to land on. */
  const selectAcross = (from: { col: number; row: number }, step: 1 | -1) => {
    for (let col = from.col + step; col >= 0 && col < visible.length; col += step) {
      const tasks = visible[col]?.tasks ?? [];
      if (tasks.length === 0) continue;
      select(tasks[Math.min(from.row, tasks.length - 1)]?.id);
      return;
    }
  };

  const fileCard = (taskId: string, target: Lifecycle) => {
    const task = taskById.get(taskId);
    // Same column is a no-op: columns carry the list's order, not a hand-placed one.
    if (!task || task.lifecycle === target) return;
    if (keepsTask && !keepsTask(task, target)) return;
    // Same flag keyboard moves set, so a remount in the target column
    // puts focus back on the card instead of leaving it on document.
    focusWanted.current = true;
    setSelectedId(taskId);
    updateTask(taskId, { lifecycle: target });
  };

  const moveCard = (step: 1 | -1) => {
    const pos = locate(selectedId);
    if (!pos || !selectedId) return;
    const target = visible[pos.col + step];
    if (!target) return;
    fileCard(selectedId, target.status);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const horizontal = e.key === "ArrowRight" || e.key === "ArrowLeft";
    const step: 1 | -1 = e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j" ? 1 : -1;

    if (e.altKey) {
      if (!horizontal) return;
      e.preventDefault();
      moveCard(step);
      return;
    }
    if (e.metaKey || e.ctrlKey) return;

    const pos = locate(selectedId);
    if (!pos) {
      // Nothing selected yet: any navigation key adopts the first card.
      if (horizontal || ["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) {
        e.preventDefault();
        select(firstCardId());
      }
      return;
    }

    if (horizontal) {
      e.preventDefault();
      selectAcross(pos, step);
      return;
    }
    if (["ArrowDown", "ArrowUp", "j", "k"].includes(e.key)) {
      e.preventDefault();
      const tasks = visible[pos.col]?.tasks ?? [];
      select(tasks[Math.min(tasks.length - 1, Math.max(0, pos.row + step))]?.id);
      return;
    }
    if (e.key === "Enter" && selectedId) {
      e.preventDefault();
      onOpen(selectedId);
    }
  };

  const sensors = useSensors(
    // Below this distance the gesture stays a click, so tapping a card still
    // opens it instead of nudging it into a neighbouring column.
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
    }),
    // Touch drags start on a long press. A plain swipe therefore scrolls the
    // columns rather than picking a card up.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const target = e.over?.id as Lifecycle | undefined;
    if (!target) return;
    fileCard(String(e.active.id), target);
  };

  const activeTask = activeId ? taskById.get(activeId) : null;

  // Announcements are built once but must read the current board, so they go
  // through a ref rather than closing over a stale partition.
  const taskByIdRef = React.useRef(taskById);
  taskByIdRef.current = taskById;
  const announcements = React.useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${taskByIdRef.current.get(String(active.id))?.title ?? "task"}.`,
      onDragOver: ({ over }) => (over ? `Over ${statusLabel(over.id as Lifecycle)}.` : undefined),
      onDragEnd: ({ over }) =>
        over ? `Filed under ${statusLabel(over.id as Lifecycle)}.` : "Left where it was.",
      onDragCancel: () => "Cancelled. The task stayed where it was.",
    }),
    [],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      {/* Key handling sits here so it catches every card, whichever is focused. */}
      <div
        onKeyDown={onKeyDown}
        className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6"
        aria-label="Task board"
      >
        <div className="flex items-start gap-2.5">
          {visible.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              tasks={column.tasks}
              selectedId={selectedId}
              focusableId={focusableId}
              onOpen={onOpen}
              onFocusTask={setSelectedId}
              registerRef={registerRef}
              emphasis={column.status === emphasisStatus}
            />
          ))}
        </div>
      </div>

      {droppedColumn ? (
        <DroppedDisclosure
          count={droppedColumn.tasks.length}
          expanded={showDropped}
          onToggle={() => setShowDropped((v) => !v)}
        />
      ) : null}

      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCard task={activeTask} onOpen={() => {}} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Dropped keeps the bargain it has on the Done page: reachable, never in the
 * way. Hidden entirely when there is nothing dropped, so the control isn't an
 * invitation to go looking at an empty column.
 */
function DroppedDisclosure({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (count === 0 && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="mt-1 flex items-center gap-1 text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
    >
      <ChevronRight
        size={13}
        className={cn(
          "transition-transform duration-200 ease-[var(--ease-product)]",
          expanded && "rotate-90",
        )}
      />
      <span>
        {expanded ? "Hide" : "Show"} {STATUS_META.dropped.label.toLowerCase()}{" "}
        <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">{count}</span>
      </span>
    </button>
  );
}

/**
 * dnd-kit's default text offers its own space-bar lift, which this board does
 * not implement. Describe the shortcut that actually exists.
 */
const screenReaderInstructions = {
  draggable:
    "Select a card with the arrow keys, then hold Alt and press the left or right arrow to move it one column.",
};
