"use client";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardColumn as BoardColumnData, selectBoardColumns } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardFace } from "./board-card";
import { BoardColumn } from "./board-column";
import { StatusIcon } from "./status-icon";

/**
 * Mouse drags wait 8px so a click still opens the card. Touch waits ~250ms
 * so a flick scrolls. PointerSensor is intentionally not used: it also
 * hears touch, and an 8px constraint would start a drag during a scroll.
 */
export const BOARD_POINTER_DISTANCE_PX = 8;
export const BOARD_TOUCH_HOLD_MS = 250;
const UNDO_MS = 6000;

/** Lifecycle this session filed into Done from, so uncomplete can restore it. */
const completedFrom = new Map<string, Lifecycle>();

export function resetBoardSessionForTests(): void {
  completedFrom.clear();
}

interface BoardMove {
  taskId: string;
  prev: Lifecycle;
  next: Lifecycle;
}

interface Cursor {
  col: number;
  index: number;
}

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function isColumnStatus(id: unknown): id is Lifecycle {
  return typeof id === "string" && STATUS_VIEWS.some((view) => view.status === id);
}

function cursorFor(columns: BoardColumnData[], taskId: string): Cursor | null {
  for (let col = 0; col < columns.length; col++) {
    const index = columns[col]?.tasks.findIndex((task) => task.id === taskId) ?? -1;
    if (index >= 0) return { col, index };
  }
  return null;
}

export function BoardView({
  tasks,
  onOpen,
  onAdd,
  syncError = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd?: (status: Lifecycle) => void;
  /** When the offline notice is up, the undo pill sits one row above it. */
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const columns = React.useMemo(() => selectBoardColumns(tasks), [tasks]);

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overStatus, setOverStatus] = React.useState<Lifecycle | null>(null);
  const [cursor, setCursor] = React.useState<Cursor>({ col: 0, index: 0 });
  const [move, setMove] = React.useState<BoardMove | null>(null);
  const [pulse, setPulse] = React.useState<{ id: string; column: Lifecycle } | null>(null);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardNodes = React.useRef(new Map<string, HTMLDivElement>());
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeded = React.useRef(false);
  const didFocus = React.useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: BOARD_POINTER_DISTANCE_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: BOARD_TOUCH_HOLD_MS, tolerance: 8 },
    }),
  );

  const activeTask = activeId ? (tasks.find((task) => task.id === activeId) ?? null) : null;

  const selection = React.useMemo(() => {
    const col = Math.max(0, Math.min(cursor.col, columns.length - 1));
    const column = columns[col];
    const len = column?.tasks.length ?? 0;
    const index = len === 0 ? 0 : Math.max(0, Math.min(cursor.index, len - 1));
    return { col, index, task: len === 0 ? undefined : column?.tasks[index] };
  }, [columns, cursor]);

  React.useEffect(() => {
    if (seeded.current) return;
    const col = columns.findIndex((column) => column.tasks.length > 0);
    if (col < 0) return;
    seeded.current = true;
    setCursor((prev) => (prev.col === col && prev.index === 0 ? prev : { col, index: 0 }));
  }, [columns]);

  React.useEffect(() => {
    const root = boardRef.current;
    if (!root) return;
    const card = selection.task ? cardNodes.current.get(selection.task.id) : null;
    const inside = root.contains(document.activeElement);
    if (!didFocus.current) {
      if (columns.every((column) => column.tasks.length === 0)) return;
      didFocus.current = true;
      (card ?? root).focus({ preventScroll: true });
      return;
    }
    if (inside && card && document.activeElement !== card) {
      card.focus({ preventScroll: true });
    }
  }, [columns, selection]);

  React.useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 1200);
    return () => clearTimeout(timer);
  }, [pulse]);

  React.useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const clearMove = React.useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setMove(null);
  }, []);

  const recordMove = React.useCallback((next: BoardMove) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setMove(next);
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setMove(null);
    }, UNDO_MS);
  }, []);

  const fileTask = React.useCallback(
    (task: Task, next: Lifecycle) => {
      if (task.lifecycle === next) return;
      if (next === "done") completedFrom.set(task.id, task.lifecycle);
      setLifecycle(task.id, next);
      recordMove({ taskId: task.id, prev: task.lifecycle, next });
      setPulse({ id: task.id, column: next });
      const landed = cursorFor(selectBoardColumns(useStore.getState().tasks), task.id);
      if (landed) setCursor(landed);
    },
    [recordMove, setLifecycle],
  );

  const undo = React.useCallback(() => {
    if (!move) return;
    const { taskId, prev } = move;
    setLifecycle(taskId, prev);
    clearMove();
    setPulse({ id: taskId, column: prev });
    const landed = cursorFor(selectBoardColumns(useStore.getState().tasks), taskId);
    if (landed) setCursor(landed);
  }, [clearMove, move, setLifecycle]);

  const onComplete = (task: Task) => {
    if (task.lifecycle === "done") {
      const restore = completedFrom.get(task.id) ?? "active";
      completedFrom.delete(task.id);
      fileTask(task, restore);
      return;
    }
    fileTask(task, "done");
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOverStatus(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    setOverStatus(isColumnStatus(event.over?.id) ? event.over.id : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = tasks.find((item) => item.id === event.active.id);
    const target = event.over?.id;
    setActiveId(null);
    setOverStatus(null);
    if (!task || !isColumnStatus(target) || target === task.lifecycle) return;
    fileTask(task, target);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setOverStatus(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !boardRef.current?.contains(target)) return;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;

    const undoChord =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey;
    if (undoChord) {
      if (!move) return;
      event.preventDefault();
      undo();
      return;
    }

    const onCard = target === boardRef.current || Boolean(target.closest("[data-board-card]"));
    if (!onCard) return;

    // Act on the focused card when one is focused, so a pointer-selected
    // card and the keyboard cursor can't file two different tasks.
    const focusedId = target.closest("[data-board-card]")?.getAttribute("data-task-id");
    const located = focusedId ? cursorFor(columns, focusedId) : null;
    const col = located?.col ?? selection.col;
    const index = located?.index ?? selection.index;
    const task = located ? columns[located.col]?.tasks[located.index] : selection.task;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const dir = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        const next = columns[col + dir];
        if (!task || !next) return;
        fileTask(task, next.status);
        return;
      }
      const nextCol = Math.max(0, Math.min(columns.length - 1, col + dir));
      const len = columns[nextCol]?.tasks.length ?? 0;
      const nextIndex = len === 0 ? 0 : Math.min(index, len - 1);
      setCursor({ col: nextCol, index: nextIndex });
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "j" ||
      event.key === "k"
    ) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      const len = columns[col]?.tasks.length ?? 0;
      if (len === 0) return;
      const dir = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
      setCursor({ col, index: Math.max(0, Math.min(len - 1, index + dir)) });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (task) onOpen(task.id);
    }
  };

  const previewCount = (status: Lifecycle, real: number) => {
    if (!activeTask) return real;
    let next = real;
    if (status === activeTask.lifecycle) next -= 1;
    if (overStatus === status) next += 1;
    return Math.max(0, next);
  };

  const hasTasks = columns.some((column) => column.tasks.length > 0);
  const selectedId = selection.task?.id ?? null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        // No keyboard sensor: space-to-drag would be a lie. Filing is Shift+arrow.
        screenReaderInstructions: {
          draggable:
            "To file this card into the next status, press shift and the left or right arrow.",
        },
      }}
    >
      <div
        ref={boardRef}
        role="listbox"
        aria-label="Board"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-w-0 outline-none"
      >
        <div
          data-board-scroller=""
          className={cn(
            "flex h-[calc(100dvh-17.5rem)] min-h-[240px] gap-3 overflow-x-auto overflow-y-hidden",
            "md:h-[calc(100dvh-15.5rem)]",
            activeId && "select-none",
          )}
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              tasks={column.tasks}
              count={previewCount(column.status, column.tasks.length)}
              labels={labels}
              selectedId={selectedId}
              pulseId={pulse?.id ?? null}
              countPulse={pulse?.column === column.status}
              onOpen={onOpen}
              onComplete={onComplete}
              onAdd={(status) => onAdd?.(status)}
              cardRef={(id, node) => {
                if (node) cardNodes.current.set(id, node);
                else cardNodes.current.delete(id);
              }}
            />
          ))}
        </div>

        {hasTasks ? (
          <p
            data-keyboard-hint=""
            className="mt-3 hidden items-center gap-1.5 text-[12px] text-[var(--fg-subtle)] md:flex"
          >
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <span>to move</span>
            <span aria-hidden="true">·</span>
            <Kbd>⇧</Kbd>
            <Kbd>←</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>→</Kbd>
            <span>to file</span>
            <span aria-hidden="true">·</span>
            <Kbd>↵</Kbd>
            <span>to open</span>
          </p>
        ) : null}

        {move ? (
          <div
            role="status"
            className={cn(
              "fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2",
              "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3 py-1.5 shadow-sm backdrop-blur",
              "text-[12.5px] text-[var(--fg)]",
              syncError ? "bottom-[140px] md:bottom-14" : "bottom-[92px] md:bottom-4",
            )}
          >
            <StatusIcon status={move.next} size={14} className="text-[var(--fg-muted)]" />
            <span>Moved to {statusLabel(move.next)}</span>
            <button
              type="button"
              onClick={undo}
              className="font-medium text-[var(--accent)] hover:underline"
            >
              Undo
            </button>
            <Kbd>⌘Z</Kbd>
          </div>
        ) : null}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? <BoardCardFace task={activeTask} labels={labels} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {STATUS_VIEWS.map((view) => (
        <div key={view.status} className="w-[288px] shrink-0 md:w-auto md:min-w-0 md:flex-1">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
