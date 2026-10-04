"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { BoardCardFace } from "./board-card";
import { BoardColumn } from "./board-column";
import {
  BOARD_POINTER_DISTANCE,
  BOARD_TOUCH_DELAY_MS,
  BOARD_UNDO_MS,
  adjacentLifecycle,
  columnCount,
  isBoardStatus,
  moveSelection,
  partitionBoard,
} from "./board-model";
import { StatusIcon } from "./status-icon";

interface UndoRecord {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    target.isContentEditable
  ) {
    return true;
  }
  const role = target.getAttribute("role");
  return role === "textbox" || role === "button" || role === "radio";
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3, 4].map((column) => (
        <div
          key={column}
          className="w-[288px] shrink-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)] p-2.5 md:w-auto md:min-w-[180px] md:flex-1"
        >
          <Skeleton className="mb-3 h-4 w-16" />
          <Skeleton className="mb-2 h-16 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-12 w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}

export function BoardView({ tasks }: { tasks: Task[] }) {
  const { openDetail, openCapture, captureOpen, commandOpen } = useFrame();
  const search = useSearchParams();
  const detailOpen = Boolean(search.get("task"));
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const updateTask = useStore((s) => s.updateTask);

  const columns = React.useMemo(() => partitionBoard(tasks), [tasks]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<Lifecycle | null>(null);
  const [settledId, setSettledId] = React.useState<string | null>(null);
  const [pulse, setPulse] = React.useState<{
    status: Lifecycle;
    key: number;
  } | null>(null);
  const [undo, setUndo] = React.useState<UndoRecord | null>(null);
  const completedFrom = React.useRef(new Map<string, Lifecycle>());
  const ignoreClick = React.useRef(false);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);

  const resolvedSelection = React.useMemo(() => {
    if (
      selectedId &&
      columns.some((column) =>
        column.tasks.some((task) => task.id === selectedId),
      )
    ) {
      return selectedId;
    }
    return moveSelection(columns, null, {});
  }, [columns, selectedId]);

  const clearUndoTimer = React.useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
  }, []);

  const pushUndo = React.useCallback(
    (record: UndoRecord) => {
      clearUndoTimer();
      setUndo(record);
      undoTimer.current = setTimeout(() => setUndo(null), BOARD_UNDO_MS);
    },
    [clearUndoTimer],
  );

  const undoRef = React.useRef(undo);
  undoRef.current = undo;

  const undoMove = React.useCallback(() => {
    const current = undoRef.current;
    if (!current) return;
    undoRef.current = null;
    setUndo(null);
    clearUndoTimer();
    updateTask(current.taskId, { lifecycle: current.from });
  }, [clearUndoTimer, updateTask]);

  React.useEffect(() => () => clearUndoTimer(), [clearUndoTimer]);

  React.useEffect(() => {
    if (!resolvedSelection) return;
    const node = document.getElementById(`board-card-${resolvedSelection}`);
    if (!node) return;
    const active = document.activeElement;
    const insideBoard = Boolean(active && boardRef.current?.contains(active));
    const onToggle =
      active instanceof HTMLElement && active.getAttribute("role") === "radio";
    // The list autofocuses so j/k work immediately. Pull focus off the
    // toggle the same way, otherwise Shift+arrow never reaches a card.
    if (
      insideBoard ||
      onToggle ||
      active === document.body ||
      active === document.documentElement
    ) {
      node.focus({ preventScroll: true });
    }
  }, [resolvedSelection]);

  React.useEffect(() => {
    if (!settledId) return;
    const timer = window.setTimeout(() => setSettledId(null), 1300);
    return () => window.clearTimeout(timer);
  }, [settledId]);

  const fileTask = React.useCallback(
    (task: Task, to: Lifecycle) => {
      if (to === task.lifecycle) return;
      if (to === "done") completedFrom.current.set(task.id, task.lifecycle);
      setLifecycle(task.id, to);
      pushUndo({ taskId: task.id, from: task.lifecycle, to });
      setSettledId(task.id);
      setPulse({ status: to, key: Date.now() });
      setSelectedId(task.id);
    },
    [pushUndo, setLifecycle],
  );

  const completeTask = React.useCallback(
    (task: Task) => {
      if (task.lifecycle === "done") {
        const restore = completedFrom.current.get(task.id) ?? "active";
        setLifecycle(task.id, restore);
        return;
      }
      completedFrom.current.set(task.id, task.lifecycle);
      setLifecycle(task.id, "done");
      setSettledId(task.id);
      setPulse({ status: "done", key: Date.now() });
    },
    [setLifecycle],
  );

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (captureOpen || commandOpen || detailOpen) return;
      // Buttons and the layout toggle own Enter / arrows. The card is a listitem, so it still receives them.
      if (isInteractiveTarget(event.target)) return;

      if (
        event.key === "z" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey
      ) {
        if (!undo) return;
        event.preventDefault();
        undoMove();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const dir = event.key === "ArrowRight" ? 1 : -1;
        if (event.shiftKey) {
          if (event.repeat) return;
          const task = tasks.find((item) => item.id === resolvedSelection);
          if (!task) return;
          const to = adjacentLifecycle(task.lifecycle, dir);
          if (!to) return;
          fileTask(task, to);
          return;
        }
        setSelectedId(moveSelection(columns, resolvedSelection, { col: dir }));
        return;
      }

      if (
        event.key === "ArrowDown" ||
        event.key === "j" ||
        event.key === "ArrowUp" ||
        event.key === "k"
      ) {
        event.preventDefault();
        const dir = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
        setSelectedId(
          moveSelection(columns, resolvedSelection, { index: dir }),
        );
        return;
      }

      if (event.key === "Enter" && resolvedSelection) {
        event.preventDefault();
        openDetail(resolvedSelection);
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    captureOpen,
    columns,
    commandOpen,
    detailOpen,
    fileTask,
    openDetail,
    resolvedSelection,
    tasks,
    undo,
    undoMove,
  ]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: BOARD_POINTER_DISTANCE },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: BOARD_TOUCH_DELAY_MS, tolerance: 8 },
    }),
  );

  const activeTask = tasks.find((task) => task.id === activeId) ?? null;

  const swallowClick = () => {
    ignoreClick.current = true;
    window.setTimeout(() => {
      ignoreClick.current = false;
    }, 0);
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setOverId(null);
  };

  const onDragOver = (event: DragOverEvent) => {
    const over = event.over?.id;
    setOverId(isBoardStatus(over) ? over : null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = tasks.find((item) => item.id === String(event.active.id));
    const over = event.over?.id;
    const to = isBoardStatus(over) ? over : null;
    setActiveId(null);
    setOverId(null);
    swallowClick();
    if (!task || !to || task.lifecycle === to) return;
    fileTask(task, to);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setOverId(null);
    swallowClick();
  };

  const hasTasks = columns.some((column) => column.tasks.length > 0);

  return (
    <div ref={boardRef} className="flex min-h-0 flex-1 flex-col">
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          data-testid="board-scroller"
          className="flex gap-3 overflow-x-auto pb-1"
        >
          {columns.map((column) => (
            <BoardColumn
              key={column.status}
              status={column.status}
              label={column.label}
              tasks={column.tasks}
              labels={labels}
              count={columnCount(column, activeTask, overId)}
              selectedId={resolvedSelection}
              settledId={settledId}
              isOver={
                overId === column.status &&
                activeTask?.lifecycle !== column.status
              }
              pulseKey={pulse?.status === column.status ? pulse.key : null}
              ignoreClick={ignoreClick}
              onOpen={openDetail}
              onComplete={completeTask}
              onSelect={setSelectedId}
              onAdd={() => openCapture({ lifecycle: column.status })}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="w-[200px] cursor-grabbing">
              <BoardCardFace task={activeTask} labels={labels} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {hasTasks ? <BoardHint /> : null}
      {undo ? (
        <div
          role="status"
          className="fixed bottom-[92px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm backdrop-blur md:bottom-4"
        >
          <StatusIcon status={undo.to} size={14} />
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

function BoardHint() {
  return (
    <p className="mt-3 hidden items-center gap-1.5 text-[12px] text-[var(--fg-subtle)] md:flex">
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
  );
}
