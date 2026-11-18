"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
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
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { BoardCardContent } from "./board-card";
import { BoardColumn } from "./board-column";
import { BOARD_COLUMNS, boardDropTarget, isBoardStatus, tasksForColumn } from "./board-model";

/**
 * Break out of the 820px reading column. Width is the main pane (capped),
 * centered against it, so five columns stay readable. Browsers without
 * container query units fall back to the reading column and scroll.
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

const UNDO_MS = 6000;

interface UndoRecord {
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
  onAdd: (lifecycle: Lifecycle) => void;
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [undo, setUndo] = React.useState<UndoRecord | null>(null);
  const [holdUndo, setHoldUndo] = React.useState(false);
  const [settledId, setSettledId] = React.useState<string | null>(null);
  const [pulse, setPulse] = React.useState<Lifecycle | null>(null);
  const [focusTick, setFocusTick] = React.useState(0);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const cardNodes = React.useRef(new Map<string, HTMLDivElement>());
  const priorLifecycle = React.useRef(new Map<string, Lifecycle>());
  const suppressClick = React.useRef(false);
  const didFocus = React.useRef(false);

  // Mouse events, not pointer events: a pointer sensor also hears touch and
  // would start a drag during a column scroll. Eight pixels keeps a click
  // on the card from becoming a drag. Touch waits so a swipe can scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const columns = React.useMemo(
    () =>
      BOARD_COLUMNS.map((column) => ({
        status: column.status,
        tasks: tasksForColumn(tasks, column.status),
      })),
    [tasks],
  );
  const anyCards = columns.some((column) => column.tasks.length > 0);
  const activeTask = activeId ? (tasks.find((task) => task.id === activeId) ?? null) : null;
  const activeFrom =
    activeTask && isBoardStatus(activeTask.lifecycle) ? activeTask.lifecycle : null;

  React.useEffect(() => {
    if (didFocus.current || !anyCards) return;
    didFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [anyCards]);

  // focusTick retriggers focus after the same card remounts in a new column.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick is the remount signal, not a value the effect reads
  React.useEffect(() => {
    if (!selectedId) return;
    cardNodes.current.get(selectedId)?.focus({ preventScroll: true });
  }, [selectedId, focusTick]);

  React.useEffect(() => {
    if (!undo || holdUndo) return;
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo, holdUndo]);

  React.useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), 700);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const rememberCard = React.useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardNodes.current.set(id, node);
    else cardNodes.current.delete(id);
  }, []);

  // The moved card remounts in another column, which drops focus to the
  // page. selectedId does not change, so bump a tick and refocus only when
  // the keyboard was already inside the board.
  const keepKeyboardFocus = React.useCallback(() => {
    const board = boardRef.current;
    const active = document.activeElement;
    if (board && active instanceof Node && board.contains(active)) {
      setFocusTick((tick) => tick + 1);
    }
  }, []);

  const moveTask = React.useCallback(
    (taskId: string, to: Lifecycle) => {
      const task = useStore.getState().tasks.find((item) => item.id === taskId);
      if (!task || task.lifecycle === to) return;
      if (to === "done") priorLifecycle.current.set(taskId, task.lifecycle);
      keepKeyboardFocus();
      setLifecycle(taskId, to);
      setUndo({ taskId, from: task.lifecycle, to });
      setSettledId(taskId);
      setPulse(to);
      setSelectedId(taskId);
    },
    [keepKeyboardFocus, setLifecycle],
  );

  const undoMove = React.useCallback(() => {
    if (!undo) return;
    keepKeyboardFocus();
    setLifecycle(undo.taskId, undo.from);
    setSettledId(undo.taskId);
    setPulse(undo.from);
    setSelectedId(undo.taskId);
    setUndo(null);
  }, [keepKeyboardFocus, setLifecycle, undo]);

  const onComplete = (task: Task) => {
    if (task.lifecycle === "done") {
      moveTask(task.id, priorLifecycle.current.get(task.id) ?? "active");
      return;
    }
    moveTask(task.id, "done");
  };

  const openCard = (id: string) => {
    if (suppressClick.current) return;
    onOpen(id);
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragOver = (event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const from = event.active.data.current?.lifecycle as Lifecycle | undefined;
    const to = from ? boardDropTarget(from, event.over ? String(event.over.id) : null) : null;
    setActiveId(null);
    setOverId(null);
    if (!to) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    moveTask(String(event.active.id), to);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(event.target)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      undoMove();
      return;
    }
    if (event.key === "Enter") {
      if ((event.target as HTMLElement).closest("button")) return;
      if (!selectedId) return;
      event.preventDefault();
      onOpen(selectedId);
      return;
    }

    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const vertical =
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "j" ||
      event.key === "k";
    if (!horizontal && !vertical) return;
    event.preventDefault();

    const dir =
      event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
    const selected = tasks.find((task) => task.id === selectedId) ?? null;
    const selectedStatus =
      selected && isBoardStatus(selected.lifecycle) ? selected.lifecycle : null;

    if (horizontal && event.shiftKey) {
      if (!selected || !selectedStatus) return;
      const index = BOARD_COLUMNS.findIndex((column) => column.status === selectedStatus);
      const next = BOARD_COLUMNS[index + dir];
      if (!next) return;
      moveTask(selected.id, next.status);
      return;
    }

    if (!selected || !selectedStatus) {
      const first = firstCard(columns);
      if (first) setSelectedId(first.id);
      return;
    }

    if (vertical) {
      const columnTasks = tasksForColumn(tasks, selectedStatus);
      const index = columnTasks.findIndex((task) => task.id === selected.id);
      const next = columnTasks[index + dir];
      if (next) setSelectedId(next.id);
      return;
    }

    const fromIndex = BOARD_COLUMNS.findIndex((column) => column.status === selectedStatus);
    const dest = BOARD_COLUMNS[fromIndex + dir];
    if (!dest) return;
    const fromTasks = tasksForColumn(tasks, selectedStatus);
    const cardIndex = Math.max(
      0,
      fromTasks.findIndex((task) => task.id === selected.id),
    );
    const destTasks = tasksForColumn(tasks, dest.status);
    if (destTasks.length === 0) return;
    const next = destTasks[Math.min(cardIndex, destTasks.length - 1)];
    if (next) setSelectedId(next.id);
  };

  return (
    <div
      ref={boardRef}
      data-testid="board"
      role="listbox"
      aria-label="Task board"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 outline-none focus-visible:!outline-none"
    >
      <DndContext
        sensors={sensors}
        autoScroll={{ threshold: { x: 0.15, y: 0.2 } }}
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
          className="flex h-[calc(100dvh-14rem)] min-w-0 snap-x snap-proximity items-stretch gap-3 overflow-x-auto pb-2 select-none md:h-[calc(100dvh-14rem)]"
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              tasks={column.tasks}
              labels={labels}
              displayCount={previewCount(column.status, column.tasks.length, activeFrom, overId)}
              isOver={overId === column.status && activeFrom !== column.status}
              pulsing={pulse === column.status}
              selectedId={selectedId}
              settledId={settledId}
              onOpen={openCard}
              onComplete={onComplete}
              onAdd={onAdd}
              cardRef={rememberCard}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? <BoardCardContent task={activeTask} labels={labels} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {anyCards ? (
        <p className="hidden items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)] md:flex">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span>to move</span>
          <span className="px-1">·</span>
          <Kbd>⇧←</Kbd>
          <Kbd>⇧→</Kbd>
          <span>to file</span>
          <span className="px-1">·</span>
          <Kbd>↵</Kbd>
          <span>to open</span>
        </p>
      ) : null}

      {undo ? (
        <div
          role="status"
          onPointerEnter={() => setHoldUndo(true)}
          onPointerLeave={() => setHoldUndo(false)}
          className={cn(
            "fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2",
            "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur",
            "px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm",
            syncError ? "bottom-[140px] md:bottom-[4.25rem]" : "bottom-[92px] md:bottom-4",
          )}
        >
          <StatusIcon status={undo.to} size={13} className="text-[var(--fg-muted)]" />
          <span>Moved to {statusLabel(undo.to)}</span>
          <button
            type="button"
            onClick={undoMove}
            className="font-medium text-[var(--fg)] hover:text-[var(--accent)]"
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
    <div className="flex gap-3 overflow-hidden" aria-hidden>
      {BOARD_COLUMNS.map((column) => (
        <div key={column.status} className="w-[288px] shrink-0 md:w-auto md:flex-1">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

function previewCount(
  status: Lifecycle,
  real: number,
  from: Lifecycle | null,
  overId: string | null,
): number {
  if (!from || !overId || overId === from) return real;
  if (status === from) return Math.max(0, real - 1);
  if (status === overId) return real + 1;
  return real;
}

function firstCard(columns: { tasks: Task[] }[]): Task | null {
  for (const column of columns) {
    if (column.tasks[0]) return column.tasks[0];
  }
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
