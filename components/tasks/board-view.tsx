"use client";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS, statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardFace } from "./board-card";
import { BoardColumn } from "./board-column";
import { StatusIcon } from "./status-icon";

/**
 * Pointer events also fire for touch, so a PointerSensor distance constraint
 * would start a drag during a column scroll. Mouse uses distance; touch uses
 * a hold, which leaves a swipe as a scroll.
 */
export const BOARD_POINTER_DISTANCE_PX = 8;
export const BOARD_TOUCH_HOLD_MS = 250;
export const BOARD_UNDO_MS = 6000;

/** Break out of the 820px reading column so five columns can sit in the main pane. */
export const BOARD_BREAKOUT_CLASS =
  "md:w-[min(1360px,100cqw)] md:ml-[calc(50%-min(1360px,100cqw)/2)] md:px-8";

const COLUMN_STATUSES: readonly Lifecycle[] = STATUS_VIEWS.map((view) => view.status);

function isColumnStatus(id: string): id is Lifecycle {
  return (COLUMN_STATUSES as readonly string[]).includes(id);
}

function tasksForColumn(status: Lifecycle, tasks: Task[]): Task[] {
  switch (status) {
    case "inbox":
      return selectInboxTasks(tasks);
    case "active":
      return selectFocusTasks(tasks);
    case "waiting":
    case "someday":
      return selectByLifecycle(tasks, status);
    case "done":
      return selectDoneTasks(tasks);
    default:
      return [];
  }
}

interface BoardUndo {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
}

export function BoardView({
  tasks,
  onOpen,
  onAdd,
  syncError = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd: (status: Lifecycle) => void;
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const didFocus = React.useRef(false);
  // Lifecycle this session filed into Done, so uncomplete can put it back.
  const priorLifecycle = React.useRef(new Map<string, Lifecycle>());

  const [colIndex, setColIndex] = React.useState(0);
  const [cardIndex, setCardIndex] = React.useState(0);
  const [followId, setFollowId] = React.useState<string | null>(null);
  const [undo, setUndo] = React.useState<BoardUndo | null>(null);
  const [landedId, setLandedId] = React.useState<string | null>(null);
  const [pulse, setPulse] = React.useState<{ status: Lifecycle; n: number } | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  const columns = React.useMemo(
    () =>
      STATUS_VIEWS.map((view) => ({
        status: view.status,
        tasks: tasksForColumn(view.status, tasks),
      })),
    [tasks],
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: BOARD_POINTER_DISTANCE_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: BOARD_TOUCH_HOLD_MS, tolerance: 8 },
    }),
  );

  const dragFrom = tasks.find((t) => t.id === activeId)?.lifecycle ?? null;
  const activeTask = dragFrom ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const selected = columns[colIndex]?.tasks[cardIndex] ?? null;
  const anyCards = columns.some((column) => column.tasks.length > 0);

  React.useEffect(() => {
    if (didFocus.current || tasks.length === 0) return;
    didFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [tasks.length]);

  React.useEffect(() => {
    if (!followId) return;
    const col = columns.findIndex((column) => column.tasks.some((t) => t.id === followId));
    if (col < 0) {
      setFollowId(null);
      return;
    }
    setColIndex(col);
    setCardIndex(columns[col]?.tasks.findIndex((t) => t.id === followId) ?? 0);
    setFollowId(null);
  }, [columns, followId]);

  React.useEffect(() => {
    if (followId) return;
    const len = columns[colIndex]?.tasks.length ?? 0;
    if (len === 0) {
      if (cardIndex !== -1) setCardIndex(-1);
      return;
    }
    if (cardIndex < 0 || cardIndex >= len) {
      setCardIndex(Math.min(Math.max(cardIndex, 0), len - 1));
    }
  }, [columns, colIndex, cardIndex, followId]);

  React.useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), BOARD_UNDO_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  React.useEffect(() => {
    if (!landedId) return;
    const id = window.setTimeout(() => setLandedId(null), 1200);
    return () => window.clearTimeout(id);
  }, [landedId]);

  React.useEffect(() => {
    if (!pulse) return;
    const id = window.setTimeout(() => setPulse(null), 600);
    return () => window.clearTimeout(id);
  }, [pulse]);

  const file = React.useCallback(
    (task: Task, to: Lifecycle, withUndo: boolean) => {
      if (task.lifecycle === to) return;
      if (to === "done") priorLifecycle.current.set(task.id, task.lifecycle);
      setLifecycle(task.id, to);
      setLandedId(task.id);
      setPulse((prev) => ({ status: to, n: (prev?.n ?? 0) + 1 }));
      setFollowId(task.id);
      if (withUndo) setUndo({ taskId: task.id, from: task.lifecycle, to });
    },
    [setLifecycle],
  );

  const undoMove = React.useCallback(() => {
    if (!undo) return;
    // Restores lifecycle only. completedAt is whatever updateTask derives,
    // not the timestamp from before the move.
    setLifecycle(undo.taskId, undo.from);
    setFollowId(undo.taskId);
    setUndo(null);
  }, [setLifecycle, undo]);

  const onComplete = React.useCallback(
    (task: Task) => {
      if (task.lifecycle === "done") {
        setLifecycle(task.id, priorLifecycle.current.get(task.id) ?? "active");
        setFollowId(task.id);
        return;
      }
      file(task, "done", false);
    },
    [file, setLifecycle],
  );

  const moveColumn = (dir: number) => {
    const next = Math.min(columns.length - 1, Math.max(0, colIndex + dir));
    setColIndex(next);
    const len = columns[next]?.tasks.length ?? 0;
    setCardIndex((i) => {
      if (len === 0) return -1;
      if (i < 0) return 0;
      return Math.min(i, len - 1);
    });
  };

  const fileSelected = (dir: number) => {
    const task = columns[colIndex]?.tasks[cardIndex];
    const dest = columns[colIndex + dir];
    if (!task || !dest) return;
    file(task, dest.status, true);
  };

  const moveWithin = (dir: number) => {
    const len = columns[colIndex]?.tasks.length ?? 0;
    if (len === 0) return;
    setCardIndex((i) => Math.min(len - 1, Math.max(0, (i < 0 ? 0 : i) + dir)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target;
    if (target instanceof HTMLElement && target.closest("button")) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && undo) {
        e.preventDefault();
        undoMove();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      if (!undo) return;
      e.preventDefault();
      undoMove();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (e.shiftKey) fileSelected(dir);
      else moveColumn(dir);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      moveWithin(1);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      moveWithin(-1);
      return;
    }
    if (e.key === "Enter" && selected) {
      e.preventDefault();
      onOpen(selected.id);
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOverId(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const to = event.over ? String(event.over.id) : null;
    const task = tasks.find((t) => t.id === String(event.active.id));
    setActiveId(null);
    setOverId(null);
    if (!task || !to || !isColumnStatus(to) || task.lifecycle === to) return;
    file(task, to, true);
  };

  const previewCount = (status: Lifecycle, base: number) => {
    if (!dragFrom || !overId || !isColumnStatus(overId) || overId === dragFrom) return base;
    if (status === dragFrom) return Math.max(0, base - 1);
    if (status === overId) return base + 1;
    return base;
  };

  return (
    <div
      ref={boardRef}
      role="listbox"
      aria-label="Board"
      aria-activedescendant={selected ? `board-card-${selected.id}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="select-none focus:outline-none"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
        }}
      >
        <div
          data-testid="board-scroller"
          className="flex snap-x snap-proximity gap-3 overflow-x-auto pb-6"
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              tasks={column.tasks}
              labels={labels}
              count={previewCount(column.status, column.tasks.length)}
              dragFrom={dragFrom}
              pulse={pulse?.status === column.status}
              selectedId={selected?.lifecycle === column.status ? selected.id : null}
              landedId={landedId}
              onOpen={onOpen}
              onComplete={onComplete}
              onAdd={onAdd}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-[288px]">
              <BoardCardFace task={activeTask} labels={labels} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {anyCards ? (
        <p
          data-testid="board-hint"
          className="mt-1 hidden items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)] md:flex"
        >
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>to move</span>
          <span aria-hidden="true">·</span>
          <Kbd>⇧←</Kbd>
          <Kbd>⇧→</Kbd>
          <span>to file</span>
          <span aria-hidden="true">·</span>
          <Kbd>↵</Kbd>
          <span>to open</span>
        </p>
      ) : null}
      {undo ? (
        <div
          role="status"
          className={cn(
            "fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2",
            "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3.5 py-1.5 shadow-sm backdrop-blur",
            "text-[12px] text-[var(--fg-muted)]",
            syncError ? "bottom-[136px] md:bottom-14" : "bottom-[92px] md:bottom-4",
          )}
        >
          <StatusIcon status={undo.to} size={13} />
          <span>Moved to {statusLabel(undo.to)}</span>
          <button
            type="button"
            onClick={undoMove}
            className="font-medium text-[var(--fg)] hover:underline"
          >
            Undo
          </button>
          <Kbd>⌘Z</Kbd>
        </div>
      ) : null}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {STATUS_VIEWS.map((view) => (
        <div key={view.status} className="w-[288px] shrink-0 md:min-w-0 md:flex-1">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-24 w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}
