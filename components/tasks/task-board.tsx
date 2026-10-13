"use client";

import { statusLabel } from "@/lib/domain/status";
import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { partitionByLifecycle, wouldRemainOnBoard } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { BoardDragProvider, useBoardDragGuard } from "./board-drag-context";
import { TaskCard } from "./task-card";
import { useCompletionGhosts } from "./task-list";

export function TaskBoard({
  tasks,
  columns,
  onOpen,
  taskFilter,
  highlightColumn,
  labelId,
  search,
}: {
  tasks: Task[];
  columns: readonly Lifecycle[];
  onOpen: (id: string) => void;
  taskFilter?: (task: Task, now: Date) => boolean;
  highlightColumn?: Lifecycle;
  labelId?: string | null;
  search?: string;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);

  const [showDropped, setShowDropped] = React.useState(false);
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const suppressClickRef = React.useRef<(taskId: string) => void>(() => {});
  const [selectedColIndex, setSelectedColIndex] = React.useState(0);
  const [selectedRowIndex, setSelectedRowIndex] = React.useState(0);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const boardRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const columnRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const visibleColumns = React.useMemo(() => {
    const base = [...columns];
    if (showDropped && !base.includes("dropped")) base.push("dropped");
    return base;
  }, [columns, showDropped]);

  const partitioned = React.useMemo(
    () => partitionByLifecycle(tasks, { labelId, search, taskFilter }, visibleColumns),
    [tasks, labelId, search, taskFilter, visibleColumns],
  );

  const visibleTasks = React.useMemo(
    () => visibleColumns.flatMap((col) => partitioned[col]),
    [visibleColumns, partitioned],
  );
  const { ghosts, dismissGhost } = useCompletionGhosts(visibleTasks);
  const ghostsByColumn = React.useMemo(
    () => placeGhostsInColumns(visibleTasks, ghosts),
    [visibleTasks, ghosts],
  );

  const resolved = React.useMemo(
    () =>
      resolveSelection(
        selectedTaskId,
        selectedColIndex,
        selectedRowIndex,
        partitioned,
        visibleColumns,
      ),
    [selectedTaskId, selectedColIndex, selectedRowIndex, partitioned, visibleColumns],
  );

  const activeTask = React.useMemo(
    () => (activeDragId ? tasks.find((t) => t.id === activeDragId) : undefined),
    [tasks, activeDragId],
  );

  const droppedCount = React.useMemo(
    () => partitionByLifecycle(tasks, { labelId, search, taskFilter }).dropped.length,
    [tasks, labelId, search, taskFilter],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragStart = (event: DragStartEvent) => {
    const taskId = String(event.active.id);
    setActiveDragId(taskId);
    setSelectedTaskId(taskId);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    setActiveDragId(null);
    handleBoardDragEnd(event, tasks, visibleColumns, setLifecycle, taskFilter);
    setSelectedTaskId(taskId);
    suppressClickRef.current(taskId);
  };

  React.useEffect(() => {
    if (!highlightColumn) return;
    const idx = visibleColumns.indexOf(highlightColumn);
    if (idx >= 0) setSelectedColIndex(idx);
    const col = scrollRef.current?.querySelector(`[data-lifecycle="${highlightColumn}"]`);
    col?.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [highlightColumn, visibleColumns]);

  const moveSelection = (dCol: number, dRow: number) => {
    if (dCol !== 0) {
      const nextCol = Math.min(visibleColumns.length - 1, Math.max(0, resolved.col + dCol));
      const nextId = partitioned[visibleColumns[nextCol]!]?.[0]?.id ?? null;
      setSelectedColIndex(nextCol);
      setSelectedRowIndex(0);
      setSelectedTaskId(nextId);
      return;
    }
    if (dRow !== 0) {
      const col = visibleColumns[resolved.col];
      const max = col ? partitioned[col].length - 1 : 0;
      const nextRow = Math.min(max, Math.max(0, resolved.row + dRow));
      const nextId = col ? (partitioned[col][nextRow]?.id ?? null) : null;
      setSelectedRowIndex(nextRow);
      setSelectedTaskId(nextId);
    }
  };

  const moveTaskOneColumn = (direction: -1 | 1) => {
    if (!resolved.taskId) return;
    const task = tasks.find((t) => t.id === resolved.taskId);
    if (!task) return;
    const order = visibleColumns;
    const currentIdx = order.indexOf(task.lifecycle);
    if (currentIdx < 0) return;
    const nextIdx = currentIdx + direction;
    if (nextIdx < 0 || nextIdx >= order.length) return;
    const nextLifecycle = order[nextIdx]!;
    if (!wouldRemainOnBoard(task, nextLifecycle, order, taskFilter)) return;
    setLifecycle(resolved.taskId, nextLifecycle);
    setSelectedTaskId(resolved.taskId);
    setSelectedColIndex(nextIdx);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (visibleColumns.length === 0) return;

    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      moveTaskOneColumn(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveSelection(-1, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveSelection(1, 0);
    } else if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      moveSelection(0, 1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      moveSelection(0, -1);
    } else if (e.key === "Enter" && resolved.taskId) {
      e.preventDefault();
      onOpen(resolved.taskId);
    }
  };

  React.useEffect(() => {
    boardRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <BoardDragProvider>
      <BoardDragProviderBridge register={suppressClickRef} />
      <div className="flex flex-col gap-3">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div
            ref={boardRef}
            role="listbox"
            tabIndex={0}
            aria-label="Task board"
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) boardRef.current?.focus();
            }}
            className="rounded-[var(--radius-lg)] focus:outline-none"
          >
            <div
              ref={scrollRef}
              className="flex gap-3 overflow-x-auto pb-2 touch-pan-x"
              style={{ touchAction: "pan-x" }}
            >
              {visibleColumns.map((lifecycle, colIndex) => (
                <BoardColumn
                  key={lifecycle}
                  lifecycle={lifecycle}
                  tasks={partitioned[lifecycle]}
                  labels={labels}
                  onOpen={onOpen}
                  activeTaskId={resolved.taskId}
                  activeTaskTabIndex={0}
                  highlighted={highlightColumn === lifecycle}
                  columnRef={(el) => {
                    columnRefs.current[colIndex] = el;
                  }}
                  ghosts={ghostsByColumn[lifecycle] ?? []}
                  onDismissGhost={dismissGhost}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <TaskCard task={activeTask} labels={labels} onOpen={onOpen} isDragOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>

        {columns.includes("done") && droppedCount > 0 ? (
          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setShowDropped((v) => !v)}
              aria-expanded={showDropped}
              className="flex w-full items-center justify-between text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              <span>
                {statusLabel("dropped")}{" "}
                <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
                  {droppedCount}
                </span>
              </span>
              <ChevronRight
                size={13}
                className={cn(
                  "transition-transform duration-200 ease-[var(--ease-product)]",
                  showDropped && "rotate-90",
                )}
              />
            </button>
          </div>
        ) : null}
      </div>
    </BoardDragProvider>
  );
}

function BoardDragProviderBridge({
  register,
}: {
  register: React.MutableRefObject<(taskId: string) => void>;
}) {
  const { suppressClickForTask } = useBoardDragGuard();
  React.useEffect(() => {
    register.current = suppressClickForTask;
  }, [register, suppressClickForTask]);
  return null;
}

function findTaskPosition(
  taskId: string,
  partitioned: Record<Lifecycle, Task[]>,
  visibleColumns: readonly Lifecycle[],
): { col: number; row: number } | null {
  for (let ci = 0; ci < visibleColumns.length; ci++) {
    const col = visibleColumns[ci]!;
    const ri = partitioned[col].findIndex((t) => t.id === taskId);
    if (ri >= 0) return { col: ci, row: ri };
  }
  return null;
}

function resolveSelection(
  selectedTaskId: string | null,
  selectedColIndex: number,
  selectedRowIndex: number,
  partitioned: Record<Lifecycle, Task[]>,
  visibleColumns: readonly Lifecycle[],
): { col: number; row: number; taskId: string | null } {
  if (selectedTaskId) {
    const pos = findTaskPosition(selectedTaskId, partitioned, visibleColumns);
    if (pos) return { ...pos, taskId: selectedTaskId };
  }
  const col = Math.min(Math.max(0, selectedColIndex), Math.max(0, visibleColumns.length - 1));
  const colId = visibleColumns[col];
  const colTasks = colId ? partitioned[colId] : [];
  const row = Math.min(Math.max(0, selectedRowIndex), Math.max(0, colTasks.length - 1));
  return { col, row, taskId: colTasks[row]?.id ?? null };
}

/**
 * `useCompletionGhosts` records index in the flattened visible-task list.
 * Map that back to a per-column splice index so a completed card stays put
 * instead of jumping to the bottom of its column.
 */
function placeGhostsInColumns(
  visibleTasks: Task[],
  ghosts: Array<{ task: Task; index: number; restoreTo: Lifecycle }>,
): Partial<Record<Lifecycle, Array<{ task: Task; restoreTo: Lifecycle; index: number }>>> {
  const merged: Array<
    { kind: "task"; task: Task } | { kind: "ghost"; task: Task; restoreTo: Lifecycle }
  > = visibleTasks.map((task) => ({ kind: "task", task }));
  // Each index is a snapshot of the ghost-free list at that completion.
  // Replay last-completed first so earlier ghosts still land at the index
  // they recorded. Sorting by index and splicing forward reverses two
  // top-to-bottom completes (both tend to record 0).
  for (const g of [...ghosts].reverse()) {
    merged.splice(Math.min(g.index, merged.length), 0, {
      kind: "ghost",
      task: g.task,
      restoreTo: g.restoreTo,
    });
  }

  const result: Partial<
    Record<Lifecycle, Array<{ task: Task; restoreTo: Lifecycle; index: number }>>
  > = {};
  const pos: Partial<Record<Lifecycle, number>> = {};
  for (const item of merged) {
    const col = item.kind === "ghost" ? item.restoreTo : item.task.lifecycle;
    const at = pos[col] ?? 0;
    pos[col] = at + 1;
    if (item.kind === "ghost") {
      const list = result[col] ?? [];
      list.push({ task: item.task, restoreTo: item.restoreTo, index: at });
      result[col] = list;
    }
  }
  return result;
}

/** Commit a cross-column drop — extracted for unit tests. */
export function handleBoardDragEnd(
  event: { active: { id: string | number }; over: { id: string | number } | null },
  tasks: Task[],
  visibleColumns: readonly Lifecycle[],
  setLifecycle: (taskId: string, lifecycle: Lifecycle) => void,
  taskFilter?: (task: Task, now: Date) => boolean,
): void {
  const taskId = String(event.active.id);
  const overId = event.over?.id;
  if (!overId) return;

  const targetLifecycle = String(overId) as Lifecycle;
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.lifecycle === targetLifecycle) return;
  if (!wouldRemainOnBoard(task, targetLifecycle, visibleColumns, taskFilter)) return;

  setLifecycle(taskId, targetLifecycle);
}

/** Resolve keyboard column move for tests. */
export function resolveColumnMove(
  lifecycle: Lifecycle,
  visibleColumns: readonly Lifecycle[],
  direction: -1 | 1,
): Lifecycle | null {
  const idx = visibleColumns.indexOf(lifecycle);
  if (idx < 0) return null;
  const next = idx + direction;
  if (next < 0 || next >= visibleColumns.length) return null;
  return visibleColumns[next] ?? null;
}

export { STATUSES_IN_ORDER };
