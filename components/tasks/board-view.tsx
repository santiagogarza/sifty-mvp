"use client";

import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import {
  BOARD_COLUMNS,
  BOARD_POINTER_DISTANCE_PX,
  BOARD_TOUCH_DELAY_MS,
  BOARD_UNDO_MS,
  type BoardStatus,
  adjacentBoardStatus,
  partitionBoard,
  resolveBoardDrop,
  toBoardStatus,
} from "@/lib/ui/board";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  type PointerSensorOptions,
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
 * Pointer events include touch. If the distance sensor handled them, a
 * column scroll would start a drag before the touch delay could reject it.
 */
class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: React.PointerEvent, { onActivation }: PointerSensorOptions) => {
        if (
          nativeEvent.pointerType !== "mouse" ||
          !nativeEvent.isPrimary ||
          nativeEvent.button !== 0
        ) {
          return false;
        }
        onActivation?.({ event: nativeEvent });
        return true;
      },
    },
  ];
}

interface DragState {
  taskId: string;
  from: BoardStatus;
  over: BoardStatus | null;
}

interface UndoRecord {
  taskId: string;
  from: Lifecycle;
  to: Lifecycle;
}

interface Cursor {
  col: number;
  index: number;
}

export function BoardView({
  tasks,
  onOpen,
  onAdd,
  syncError = false,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  onAdd?: (lifecycle: BoardStatus) => void;
  syncError?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const labelById = React.useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const setLifecycle = useStore((s) => s.setLifecycle);
  const grouped = React.useMemo(() => partitionBoard(tasks), [tasks]);
  const columns = React.useMemo(
    () =>
      BOARD_COLUMNS.flatMap((column) => {
        const status = toBoardStatus(column.status);
        if (!status) return [];
        return [{ ...column, status, tasks: grouped[status] }];
      }),
    [grouped],
  );
  const hasTasks = columns.some((column) => column.tasks.length > 0);

  const [cursor, setCursor] = React.useState<Cursor>({ col: 0, index: -1 });
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [undo, setUndo] = React.useState<UndoRecord | null>(null);
  const [landed, setLanded] = React.useState<{ id: string; nonce: number } | null>(null);
  const [pulse, setPulse] = React.useState<{ status: BoardStatus; nonce: number } | null>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const didFocus = React.useRef(false);
  const priorDone = React.useRef(new Map<string, Lifecycle>());
  const undoRef = React.useRef<UndoRecord | null>(null);
  undoRef.current = undo;

  const sensors = useSensors(
    useSensor(BoardPointerSensor, {
      activationConstraint: { distance: BOARD_POINTER_DISTANCE_PX },
    }),
    useSensor(TouchSensor, { activationConstraint: { delay: BOARD_TOUCH_DELAY_MS, tolerance: 8 } }),
  );

  React.useEffect(() => {
    if (!hasTasks || didFocus.current) return;
    didFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [hasTasks]);

  React.useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), BOARD_UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo]);

  React.useEffect(() => {
    if (!pulse) return;
    const nonce = pulse.nonce;
    const timer = window.setTimeout(() => {
      setPulse((current) => (current?.nonce === nonce ? null : current));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const selectedTask = columns[cursor.col]?.tasks[cursor.index] ?? null;
  const selectedId = selectedTask?.id ?? null;

  React.useEffect(() => {
    if (!selectedId) return;
    const card = document.getElementById(`card-${selectedId}`);
    if (typeof card?.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedId]);

  const fileTask = React.useCallback(
    (task: Task, next: BoardStatus) => {
      if (task.lifecycle === next) return;
      if (next === "done") priorDone.current.set(task.id, task.lifecycle);
      setLifecycle(task.id, next);
      const record = { taskId: task.id, from: task.lifecycle, to: next };
      setUndo(record);
      setLanded((current) => ({ id: task.id, nonce: (current?.nonce ?? 0) + 1 }));
      setPulse((current) => ({ status: next, nonce: (current?.nonce ?? 0) + 1 }));
      if (selectedId === task.id) {
        const dest = partitionBoard(useStore.getState().tasks)[next];
        const index = dest.findIndex((entry) => entry.id === task.id);
        const col = BOARD_COLUMNS.findIndex((entry) => entry.status === next);
        setCursor({ col, index: Math.max(0, index) });
      }
    },
    [selectedId, setLifecycle],
  );

  const performUndo = React.useCallback(() => {
    const current = undoRef.current;
    if (!current) return;
    setLifecycle(current.taskId, current.from);
    setUndo(null);
    setLanded((prev) => ({ id: current.taskId, nonce: (prev?.nonce ?? 0) + 1 }));
    const restored = toBoardStatus(current.from);
    if (restored) {
      setPulse((prev) => ({ status: restored, nonce: (prev?.nonce ?? 0) + 1 }));
      const index = partitionBoard(useStore.getState().tasks)[restored].findIndex(
        (task) => task.id === current.taskId,
      );
      const col = BOARD_COLUMNS.findIndex((entry) => entry.status === restored);
      if (index >= 0 && col >= 0) setCursor({ col, index });
    }
  }, [setLifecycle]);

  const onComplete = (task: Task) => {
    if (task.lifecycle === "done") {
      const restore = priorDone.current.get(task.id) ?? "active";
      const column = toBoardStatus(restore);
      if (!column) {
        setLifecycle(task.id, restore);
        return;
      }
      fileTask(task, column);
      return;
    }
    fileTask(task, "done");
  };

  // Container handler, not a document listener: capture, the palette, and the
  // detail sheet are portaled dialogs that trap focus, so this stays inert
  // while they are open. Their open state isn't available outside AppFrame.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      event.preventDefault();
      performUndo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      fileBy(1);
      return;
    }
    if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      fileBy(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCol(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCol(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      moveRow(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      moveRow(-1);
      return;
    }
    if (event.key === "Enter" && selectedTask) {
      event.preventDefault();
      onOpen(selectedTask.id);
    }
  };

  function moveCol(delta: number) {
    setCursor((current) => {
      const col = Math.min(columns.length - 1, Math.max(0, current.col + delta));
      const len = columns[col]?.tasks.length ?? 0;
      const index =
        len === 0 ? -1 : Math.min(len - 1, Math.max(0, current.index < 0 ? 0 : current.index));
      return { col, index };
    });
  }

  function moveRow(delta: number) {
    setCursor((current) => {
      const len = columns[current.col]?.tasks.length ?? 0;
      if (len === 0) return current;
      if (current.index < 0) return { ...current, index: 0 };
      return { ...current, index: Math.min(len - 1, Math.max(0, current.index + delta)) };
    });
  }

  function fileBy(delta: -1 | 1) {
    const column = columns[cursor.col];
    const task = column?.tasks[cursor.index];
    if (!column || !task) return;
    const next = adjacentBoardStatus(column.status, delta);
    if (!next) return;
    fileTask(task, next);
  }

  const onDragStart = (event: DragStartEvent) => {
    const task = tasks.find((entry) => entry.id === event.active.id);
    if (!task) return;
    const from = toBoardStatus(task.lifecycle);
    if (!from) return;
    setDrag({ taskId: task.id, from, over: null });
  };

  const onDragOver = (event: DragOverEvent) => {
    const overId = toBoardStatus(event.over ? String(event.over.id) : null);
    setDrag((current) => {
      if (!current) return current;
      return { ...current, over: overId };
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const task = tasks.find((entry) => entry.id === event.active.id);
    const next = task
      ? resolveBoardDrop(task.lifecycle, event.over ? String(event.over.id) : null)
      : null;
    setDrag(null);
    if (task && next) fileTask(task, next);
  };

  const activeTask = drag ? (tasks.find((entry) => entry.id === drag.taskId) ?? null) : null;
  const activeLabel = activeTask
    ? (activeTask.labelIds.map((id) => labelById.get(id)).find((label) => label) ?? null)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Drag a card to another column to file it. From the keyboard, press shift and an arrow key.",
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <div
        ref={boardRef}
        role="listbox"
        tabIndex={0}
        aria-label="Board"
        aria-activedescendant={selectedId ? `card-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
        className="rounded-[var(--radius-lg)] focus:outline-none"
      >
        <div
          role="region"
          aria-label="Columns"
          className="flex h-[calc(100dvh-18rem)] gap-3 overflow-x-auto overflow-y-hidden pb-1 md:h-[calc(100dvh-16rem)]"
        >
          {columns.map((column) => {
            const base = column.tasks.length;
            const count = previewCount(column.status, base, drag);
            return (
              <BoardColumn
                key={column.status}
                status={column.status}
                label={column.label}
                tasks={column.tasks}
                count={count}
                tinted={drag !== null && drag.over === column.status && drag.from !== column.status}
                pulse={pulse?.status === column.status}
                labelById={labelById}
                selectedId={selectedId}
                landedId={landed?.id ?? null}
                onOpen={onOpen}
                onComplete={onComplete}
                onAdd={onAdd}
              />
            );
          })}
        </div>
        {hasTasks ? <BoardHint /> : null}
        {undo ? (
          <div
            role="status"
            className={cn(
              "fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2",
              "rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3.5 py-1.5",
              "text-[12px] text-[var(--fg-muted)] shadow-sm backdrop-blur",
              syncError ? "bottom-[140px] md:bottom-16" : "bottom-[92px] md:bottom-4",
            )}
          >
            <StatusIcon status={undo.to} size={13} />
            <span>Moved to {statusLabel(undo.to)}</span>
            <button type="button" onClick={performUndo} className="font-medium text-[var(--fg)]">
              Undo
            </button>
            <Kbd>⌘Z</Kbd>
          </div>
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="w-[260px]">
            <BoardCardFace task={activeTask} firstLabel={activeLabel} lifted />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function previewCount(status: BoardStatus, base: number, drag: DragState | null): number {
  if (!drag) return base;
  if (drag.from === status && drag.over !== status) return Math.max(0, base - 1);
  if (drag.over === status && drag.from !== status) return base + 1;
  return base;
}

function BoardHint() {
  return (
    <p className="mt-3 hidden items-center gap-1.5 text-[11.5px] text-[var(--fg-subtle)] md:flex">
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

export function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-hidden="true">
      {BOARD_COLUMNS.map((column) => (
        <div
          key={column.status}
          className="h-[420px] w-[288px] shrink-0 rounded-[var(--radius-lg)] border border-[var(--border)] p-3 md:w-auto md:flex-1"
        >
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-16 w-full rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}
