"use client";

import { STATUSES_IN_ORDER, STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  adjacentLifecycle,
  droppableId,
  partitionByLifecycle,
  resolveBoardDrop,
} from "@/lib/store/board";
import type { ViewArgs } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import * as React from "react";
import { BoardColumn } from "./board-column";
import { TaskCard } from "./task-card";

/**
 * Break out of the 820px reading column so five pipeline columns can sit
 * in a horizontal scroller. Sized against <main> (container-type: inline-size).
 */
export const BOARD_BREAKOUT_CLASS = "w-[min(1360px,100cqw)] ml-[calc(50%-min(1360px,100cqw)/2)]";
export const BOARD_GUTTER_CLASS = "px-4 sm:px-6 md:px-8";

const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function TaskBoard({
  tasks,
  viewArgs = {},
  columns,
  allowDropped = true,
  onOpen,
}: {
  tasks: Task[];
  viewArgs?: ViewArgs;
  /** Visible pipeline. Defaults to every status except dropped. */
  columns?: readonly Lifecycle[];
  allowDropped?: boolean;
  onOpen: (id: string) => void;
}) {
  const pathname = usePathname();
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const updateTask = useStore((s) => s.updateTask);
  const openDetail = onOpen;

  const highlight = STATUS_VIEWS.find((v) => v.href === pathname)?.status ?? null;

  const baseColumns = columns ?? STATUSES_IN_ORDER.filter((s) => s !== "dropped");
  const [showDropped, setShowDropped] = React.useState(false);
  const visibleColumns = React.useMemo(() => {
    if (allowDropped && showDropped && !baseColumns.includes("dropped")) {
      return [...baseColumns, "dropped"] as Lifecycle[];
    }
    return [...baseColumns];
  }, [allowDropped, showDropped, baseColumns]);

  const partitioned = React.useMemo(
    () => partitionByLifecycle(tasks, viewArgs, visibleColumns),
    [tasks, viewArgs, visibleColumns],
  );

  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [cursor, setCursor] = React.useState<{ col: number; row: number }>({
    col: 0,
    row: -1,
  });
  const boardRef = React.useRef<HTMLDivElement>(null);
  const highlightRef = React.useRef<HTMLElement | null>(null);

  const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const selected = locateTask(selectedId, visibleColumns, partitioned, cursor);
  const selectedTask = taskAt(selected, visibleColumns, partitioned);

  React.useEffect(() => {
    if (!highlight) return;
    highlightRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [highlight]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const commit = resolveBoardDrop(String(e.active.id), e.over?.id as string | undefined, tasks);
    if (!commit) return;
    setLifecycle(commit.taskId, commit.lifecycle);
    setSelectedId(commit.taskId);
  };

  const onComplete = React.useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      updateTask(taskId, { lifecycle: task.lifecycle === "done" ? "active" : "done" });
    },
    [tasks, updateTask],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && selectedTask) {
      e.preventDefault();
      openDetail(selectedTask.id);
      return;
    }

    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) {
      e.preventDefault();
      if (!selectedTask) return;
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      const next = adjacentLifecycle(selectedTask.lifecycle, delta, visibleColumns);
      if (!next) return;
      setLifecycle(selectedTask.id, next);
      setSelectedId(selectedTask.id);
      return;
    }

    if (e.altKey || e.metaKey || e.ctrlKey) return;

    const selectAfterMove = (dCol: number, dRow: number) => {
      const next = moveSelection(selected, visibleColumns, partitioned, dCol, dRow);
      setCursor(next);
      setSelectedId(taskAt(next, visibleColumns, partitioned)?.id ?? null);
    };

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectAfterMove(-1, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      selectAfterMove(1, 0);
    } else if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      selectAfterMove(0, 1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      selectAfterMove(0, -1);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className={cn(BOARD_BREAKOUT_CLASS, "select-none")}>
        <div
          ref={boardRef}
          role="listbox"
          aria-label="Task board"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className={cn(
            "flex gap-3 overflow-x-auto pb-8 snap-x snap-proximity touch-pan-x touch-pan-y",
            BOARD_GUTTER_CLASS,
          )}
          style={{ touchAction: "pan-x pan-y" }}
        >
          {visibleColumns.map((lifecycle) => (
            <BoardColumn
              key={lifecycle}
              lifecycle={lifecycle}
              tasks={partitioned[lifecycle]}
              labels={labels}
              onOpen={openDetail}
              onComplete={onComplete}
              selectedTaskId={selectedTask?.id ?? null}
              highlighted={lifecycle === highlight}
              columnRef={lifecycle === highlight ? highlightRef : undefined}
            />
          ))}
        </div>

        {allowDropped && !baseColumns.includes("dropped") ? (
          <div className={cn(BOARD_GUTTER_CLASS, "pb-10")}>
            <button
              type="button"
              onClick={() => setShowDropped((v) => !v)}
              aria-expanded={showDropped}
              aria-controls={droppableId("dropped")}
              className="flex items-center gap-1.5 text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            >
              <ChevronRight
                size={13}
                className={cn(
                  "transition-transform duration-200 ease-[var(--ease-product)]",
                  showDropped && "rotate-90",
                )}
              />
              {showDropped ? "Hide dropped" : "Show dropped"}
              <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">
                {partitionByLifecycle(tasks, viewArgs, ["dropped"]).dropped.length}
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            labels={labels}
            onOpen={() => undefined}
            onComplete={() => undefined}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function locateTask(
  taskId: string | null,
  columns: readonly Lifecycle[],
  partitioned: Record<Lifecycle, Task[]>,
  fallback: { col: number; row: number } = { col: 0, row: -1 },
): { col: number; row: number } {
  if (!taskId) return fallback;
  for (let col = 0; col < columns.length; col++) {
    const row = (partitioned[columns[col]!] ?? []).findIndex((t) => t.id === taskId);
    if (row >= 0) return { col, row };
  }
  return { col: 0, row: -1 };
}

function taskAt(
  pos: { col: number; row: number },
  columns: readonly Lifecycle[],
  partitioned: Record<Lifecycle, Task[]>,
): Task | null {
  return columns[pos.col] ? (partitioned[columns[pos.col]!]?.[pos.row] ?? null) : null;
}

function moveSelection(
  current: { col: number; row: number },
  columns: readonly Lifecycle[],
  partitioned: Record<Lifecycle, Task[]>,
  dCol: number,
  dRow: number,
): { col: number; row: number } {
  const col = Math.max(0, Math.min(columns.length - 1, current.col + dCol));
  const list = partitioned[columns[col]!] ?? [];
  if (list.length === 0) return { col, row: -1 };
  const startRow = current.row < 0 ? (dRow > 0 ? -1 : 0) : current.row;
  const row = Math.max(0, Math.min(list.length - 1, startRow + dRow));
  return { col, row };
}
