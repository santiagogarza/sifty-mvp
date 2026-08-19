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
  MeasuringStrategy,
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
  const pointer = usePointerPosition();
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
    if (!willFile(task, target, keepsTask)) return;
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
    const target = dropTarget(pointer.current, e.over?.id);
    if (!target) return;
    fileCard(String(e.active.id), target);
  };

  const activeTask = activeId ? taskById.get(activeId) : null;

  // Announcements are built once but must read the current board, so they go
  // through a ref rather than closing over a stale partition.
  const taskByIdRef = React.useRef(taskById);
  taskByIdRef.current = taskById;
  const keepsTaskRef = React.useRef(keepsTask);
  keepsTaskRef.current = keepsTask;
  const announcements = React.useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        `Picked up ${taskByIdRef.current.get(String(active.id))?.title ?? "task"}.`,
      onDragOver: ({ over }) => (over ? `Over ${statusLabel(over.id as Lifecycle)}.` : undefined),
      onDragEnd: ({ active, over }) => {
        // Resolved the same way the drop itself is, or the live region could
        // name a column the card did not go to.
        const target = dropTarget(pointer.current, over?.id);
        if (!target) return "Left where it was.";
        const task = taskByIdRef.current.get(String(active.id));
        return willFile(task, target, keepsTaskRef.current)
          ? `Filed under ${statusLabel(target)}.`
          : "Left where it was.";
      },
      onDragCancel: () => "Cancelled. The task stayed where it was.",
    }),
    [pointer],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
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
 * The column a drop belongs to. Where the pointer actually is beats where
 * dnd-kit last believed it was, so the geometry wins and `over` is the
 * fallback for when there is no pointer to consult.
 */
function dropTarget(
  point: { x: number; y: number } | null,
  over: string | number | undefined,
): Lifecycle | null {
  return columnAt(point) ?? (over as Lifecycle | undefined) ?? null;
}

/** Which column, if any, sits under a point on screen. */
function columnAt(point: { x: number; y: number } | null): Lifecycle | null {
  if (!point) return null;
  for (const node of document.querySelectorAll<HTMLElement>("[data-column-status]")) {
    const rect = node.getBoundingClientRect();
    if (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    ) {
      return (node.dataset.columnStatus as Lifecycle) ?? null;
    }
  }
  return null;
}

/**
 * The pointer's own position, tracked for as long as a button is held.
 *
 * dnd-kit only learns where the pointer is from moves that arrive *after* the
 * one which started the drag. When a single event both crosses the activation
 * distance and lands on another column — browsers coalesce pointer moves under
 * load, which is exactly what a board carrying a couple hundred cards causes —
 * the drag ends reporting a zero delta and no target, and the card silently
 * stays put. Losing a deliberate move that way is worse than the cost of
 * watching the pointer, so the drop point comes from here when dnd-kit has
 * nothing to offer.
 */
function usePointerPosition(): React.RefObject<{ x: number; y: number } | null> {
  const pointer = React.useRef<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    const track = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const start = (e: PointerEvent) => {
      track(e);
      window.addEventListener("pointermove", track, { passive: true });
    };
    const stop = (e: PointerEvent) => {
      track(e);
      window.removeEventListener("pointermove", track);
    };

    window.addEventListener("pointerdown", start, { passive: true });
    window.addEventListener("pointerup", stop, { passive: true });
    window.addEventListener("pointercancel", stop, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("pointermove", track);
    };
  }, []);

  return pointer;
}

/**
 * Whether `fileCard` would actually call `updateTask`. The live-region copy
 * uses the same gate so a refused Today drop is not announced as filed.
 */
function willFile(
  task: Task | undefined,
  target: Lifecycle,
  gate?: (task: Task, next: Lifecycle) => boolean,
): boolean {
  if (!task || task.lifecycle === target) return false;
  return !gate || gate(task, target);
}

/**
 * dnd-kit's default text offers its own space-bar lift, which this board does
 * not implement. Describe the shortcut that actually exists.
 */
const screenReaderInstructions = {
  draggable:
    "Select a card with the arrow keys, then hold Alt and press the left or right arrow to move it one column.",
};
