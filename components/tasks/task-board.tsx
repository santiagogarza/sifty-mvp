"use client";

import { BOARD_COLUMNS, lifecycleLabel } from "@/lib/domain/lifecycle";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { groupTasksByLifecycle } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import * as React from "react";
import { TaskBoardCard } from "./task-board-card";

type DropData = { type: "column"; column: Lifecycle };

const collisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCenter(args);
};

export function TaskBoard({
  tasks,
  onOpen,
  emptyState,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  emptyState?: React.ReactNode;
}) {
  const labels = useStore((s) => s.labels);
  const setLifecycle = useStore((s) => s.setLifecycle);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [overColumn, setOverColumn] = React.useState<Lifecycle | null>(null);

  const grouped = React.useMemo(() => groupTasksByLifecycle(tasks), [tasks]);
  const activeTask = React.useMemo(
    () => (activeId ? tasks.find((t) => t.id === activeId) : undefined),
    [activeId, tasks],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const resolveColumn = React.useCallback((over: DragOverEvent["over"] | DragEndEvent["over"]) => {
    if (!over) return null;
    const data = over.data.current as DropData | undefined;
    if (data?.type === "column") return data.column;
    if (BOARD_COLUMNS.includes(over.id as Lifecycle)) return over.id as Lifecycle;
    return null;
  }, []);

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragOver = (event: DragOverEvent) => {
    setOverColumn(resolveColumn(event.over));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumn(null);

    if (!over) return;

    const taskId = String(active.id);
    const targetColumn = resolveColumn(over);
    if (!targetColumn) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.lifecycle === targetColumn) return;

    setLifecycle(taskId, targetColumn);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setOverColumn(null);
  };

  if (tasks.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        className={cn(
          "flex gap-3 overflow-x-auto pb-2 -mx-1 px-1",
          "snap-x snap-mandatory md:snap-none",
        )}
      >
        {BOARD_COLUMNS.map((column) => (
          <BoardColumn
            key={column}
            column={column}
            tasks={grouped.get(column) ?? []}
            labels={labels}
            onOpen={onOpen}
            isOver={overColumn === column && activeId !== null}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0.18, 1)" }}>
        {activeTask ? (
          <TaskBoardCard task={activeTask} labels={labels} onOpen={onOpen} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  tasks,
  labels,
  onOpen,
  isOver,
}: {
  column: Lifecycle;
  tasks: Task[];
  labels: ReturnType<typeof useStore.getState>["labels"];
  onOpen: (id: string) => void;
  isOver: boolean;
}) {
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: column,
    data: { type: "column", column } satisfies DropData,
  });

  const highlighted = isOver || isDroppableOver;

  return (
    <div
      className={cn(
        "flex w-[260px] shrink-0 flex-col snap-start",
        "rounded-[var(--radius-lg)] border border-transparent",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        highlighted && "border-[var(--accent)]/25 bg-[var(--accent)]/[0.03]",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-[12px] font-medium tracking-[0.02em] text-[var(--fg-muted)] uppercase">
          {lifecycleLabel(column)}
        </h2>
        <span className="text-num text-[11px] tabular-nums text-[var(--fg-subtle)]">
          {tasks.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[160px] flex-1 flex-col gap-2 rounded-[var(--radius-md)] p-1.5",
          "bg-[var(--surface-muted)]/50",
          highlighted && "bg-[var(--surface-muted)]",
        )}
      >
        {tasks.map((task) => (
          <TaskBoardCard key={task.id} task={task} labels={labels} onOpen={onOpen} />
        ))}
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-2 py-6 pointer-events-none">
            <p className="text-center text-[11px] text-[var(--fg-subtle)]">Drop tasks here</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
