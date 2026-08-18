"use client";

import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardPartitionArgs, partitionByLifecycle } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";

export const ALL_BOARD_COLUMNS = STATUSES_IN_ORDER;
export const TODAY_BOARD_COLUMNS = ["inbox", "active", "waiting"] as const;
const EMPTY_BOARD_ARGS: BoardPartitionArgs = {};

export function TaskBoard({
  tasks,
  onOpen,
  columns = ALL_BOARD_COLUMNS,
  partitionArgs = EMPTY_BOARD_ARGS,
  emphasizedColumn,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  columns?: readonly Lifecycle[];
  partitionArgs?: BoardPartitionArgs;
  emphasizedColumn?: Lifecycle;
}) {
  const labels = useStore((state) => state.labels);
  const setLifecycle = useStore((state) => state.setLifecycle);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);
  const [showDropped, setShowDropped] = React.useState(false);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const didInitialFocus = React.useRef(false);
  const didInitialScroll = React.useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const partition = React.useMemo(
    () => partitionByLifecycle(tasks, partitionArgs, columns),
    [tasks, partitionArgs, columns],
  );
  const supportsDropped = columns.includes("dropped");
  const visibleColumns = React.useMemo(
    () => columns.filter((column) => column !== "dropped" || showDropped),
    [columns, showDropped],
  );
  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) : undefined;
  const selectedTaskLifecycle = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId)?.lifecycle
    : undefined;

  React.useEffect(() => {
    if (didInitialFocus.current || tasks.length === 0) return;
    didInitialFocus.current = true;
    boardRef.current?.focus({ preventScroll: true });
  }, [tasks.length]);

  React.useEffect(() => {
    if (didInitialScroll.current || !emphasizedColumn) return;
    const column = boardRef.current?.querySelector<HTMLElement>(
      `[data-board-column="${emphasizedColumn}"]`,
    );
    if (!column) return;
    didInitialScroll.current = true;
    column.scrollIntoView({ behavior: "instant", inline: "center", block: "nearest" });
  }, [emphasizedColumn]);

  React.useEffect(() => {
    if (!selectedTaskId) return;
    const selectedStillVisible = visibleColumns.some((column) =>
      partition[column].some((task) => task.id === selectedTaskId),
    );
    if (!selectedStillVisible) setSelectedTaskId(null);
  }, [partition, selectedTaskId, visibleColumns]);

  React.useEffect(() => {
    if (!selectedTaskId || !selectedTaskLifecycle) return;
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-task-id="${selectedTaskId}"]`)
      ?.focus({ preventScroll: true });
  }, [selectedTaskId, selectedTaskLifecycle]);

  const selectFirstTask = React.useCallback((): Task | undefined => {
    for (const column of visibleColumns) {
      const task = partition[column][0];
      if (task) {
        setSelectedTaskId(task.id);
        return task;
      }
    }
  }, [partition, visibleColumns]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const selected =
      (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) : undefined) ??
      selectFirstTask();
    if (!selected) return;

    const columnIndex = visibleColumns.indexOf(selected.lifecycle);
    const columnTasks = partition[selected.lifecycle];
    const taskIndex = columnTasks.findIndex((task) => task.id === selected.id);

    if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const target = visibleColumns[columnIndex + direction];
      if (target) setLifecycle(selected.id, target);
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return;

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      const next = columnTasks[Math.min(columnTasks.length - 1, taskIndex + 1)];
      if (next) setSelectedTaskId(next.id);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      const next = columnTasks[Math.max(0, taskIndex - 1)];
      if (next) setSelectedTaskId(next.id);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      for (
        let nextColumnIndex = columnIndex + direction;
        nextColumnIndex >= 0 && nextColumnIndex < visibleColumns.length;
        nextColumnIndex += direction
      ) {
        const nextColumn = visibleColumns[nextColumnIndex];
        if (!nextColumn) continue;
        const nextTasks = partition[nextColumn];
        const next = nextTasks[Math.min(Math.max(taskIndex, 0), nextTasks.length - 1)];
        if (next) {
          setSelectedTaskId(next.id);
          break;
        }
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(selected.id);
    }
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    setActiveTaskId(id);
    setSelectedTaskId(id);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTaskId(null);
    if (!over) return;
    const task = tasks.find((candidate) => candidate.id === String(active.id));
    const lifecycle = String(over.id) as Lifecycle;
    if (!task || !visibleColumns.includes(lifecycle) || task.lifecycle === lifecycle) return;
    setLifecycle(task.id, lifecycle);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragCancel={() => setActiveTaskId(null)}
      onDragEnd={onDragEnd}
    >
      <div
        ref={boardRef}
        role="listbox"
        aria-label="Task board"
        aria-describedby="task-board-shortcuts"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="touch-pan-x overflow-x-auto overscroll-x-contain pb-5 focus:outline-none"
      >
        <p id="task-board-shortcuts" className="sr-only">
          Use arrow keys to select tasks. Hold Alt or Option and press left or right to move a task.
          Press Enter to open it.
        </p>
        <div className="flex min-w-max items-stretch gap-3">
          {visibleColumns.map((lifecycle) => (
            <BoardColumn
              key={lifecycle}
              lifecycle={lifecycle}
              tasks={partition[lifecycle]}
              labels={labels}
              selectedTaskId={selectedTaskId}
              emphasized={lifecycle === emphasizedColumn}
              onOpen={onOpen}
              onSelect={setSelectedTaskId}
            />
          ))}
          {supportsDropped && !showDropped ? (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setShowDropped(true)}
              className={cn(
                "flex w-32 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] border border-dashed",
                "text-[12px] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)]",
              )}
            >
              Show dropped
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCard task={activeTask} labels={labels} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
