"use client";

import { Badge } from "@/components/ui/badge";
import { bucketTone } from "@/lib/domain/priority";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";
import {
  TASK_BOARD_COLUMNS,
  TASK_BOARD_LIFECYCLES,
  isTaskBoardLifecycle,
  taskBoardLifecycleAfter,
} from "./task-board-model";

export function TaskBoard({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const labels = useStore((s) => s.labels);
  const updateTask = useStore((s) => s.updateTask);
  const [dragOverLifecycle, setDragOverLifecycle] = React.useState<Lifecycle | null>(null);
  const [draggingTaskId, setDraggingTaskId] = React.useState<string | null>(null);

  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);

  const tasksByLifecycle = React.useMemo(() => {
    const grouped = new Map<Lifecycle, Task[]>();
    for (const column of TASK_BOARD_COLUMNS) grouped.set(column.lifecycle, []);
    for (const task of tasks) {
      if (!isTaskBoardLifecycle(task.lifecycle)) continue;
      grouped.get(task.lifecycle)?.push(task);
    }
    for (const columnTasks of grouped.values()) {
      columnTasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    return grouped;
  }, [tasks]);

  const moveTask = React.useCallback(
    (task: Task, lifecycle: Lifecycle) => {
      if (task.lifecycle === lifecycle) return;
      updateTask(task.id, { lifecycle });
    },
    [updateTask],
  );

  const moveByOffset = React.useCallback(
    (task: Task, offset: -1 | 1) => {
      const lifecycle = taskBoardLifecycleAfter(task.lifecycle, offset);
      if (lifecycle) moveTask(task, lifecycle);
    },
    [moveTask],
  );

  const onDrop = (event: React.DragEvent, lifecycle: Lifecycle) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain");
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (task) moveTask(task, lifecycle);
    setDragOverLifecycle(null);
    setDraggingTaskId(null);
  };

  return (
    <div
      className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3 overflow-x-auto pb-2"
      aria-label="Kanban task board"
    >
      {TASK_BOARD_COLUMNS.map((column) => {
        const columnTasks = tasksByLifecycle.get(column.lifecycle) ?? [];
        const isDropTarget = dragOverLifecycle === column.lifecycle;

        return (
          <section
            key={column.lifecycle}
            aria-labelledby={`board-column-${column.lifecycle}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverLifecycle(column.lifecycle);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragOverLifecycle(null);
              }
            }}
            onDrop={(event) => onDrop(event, column.lifecycle)}
            className={cn(
              "min-h-[420px] rounded-[var(--radius-lg)] border bg-[var(--surface-muted)]/55",
              "transition-[background,border,box-shadow] duration-150 ease-[var(--ease-product)]",
              isDropTarget
                ? "border-[var(--accent)]/45 bg-[var(--accent-soft)]/40 shadow-[0_0_0_1px_var(--accent-soft)]"
                : "border-[var(--border)]",
            )}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-[var(--radius-lg)] border-b border-[var(--border)] bg-[var(--surface-muted)]/90 px-3 py-2.5 backdrop-blur">
              <h2
                id={`board-column-${column.lifecycle}`}
                className="text-[12px] font-medium text-[var(--fg)]"
              >
                {column.title}
              </h2>
              <span className="text-num text-[11px] text-[var(--fg-subtle)]">
                {columnTasks.length}
              </span>
            </div>
            <div className="flex flex-col gap-2 p-2.5">
              {columnTasks.map((task) => (
                <TaskBoardCard
                  key={task.id}
                  task={task}
                  labelMap={labelMap}
                  dragging={draggingTaskId === task.id}
                  canMoveLeft={TASK_BOARD_LIFECYCLES.indexOf(task.lifecycle) > 0}
                  canMoveRight={
                    TASK_BOARD_LIFECYCLES.indexOf(task.lifecycle) < TASK_BOARD_LIFECYCLES.length - 1
                  }
                  onOpen={onOpen}
                  onMoveLeft={() => moveByOffset(task, -1)}
                  onMoveRight={() => moveByOffset(task, 1)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", task.id);
                    setDraggingTaskId(task.id);
                  }}
                  onDragEnd={() => {
                    setDragOverLifecycle(null);
                    setDraggingTaskId(null);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskBoardCard({
  task,
  labelMap,
  dragging,
  canMoveLeft,
  canMoveRight,
  onOpen,
  onMoveLeft,
  onMoveRight,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  dragging: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onOpen: (id: string) => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";
  const isDone = task.lifecycle === "done";

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5",
        "shadow-[0_1px_1px_oklch(0%_0_0/0.03)] transition-[background,border,box-shadow,opacity,transform]",
        "duration-150 ease-[var(--ease-product)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
        "focus-within:border-[var(--border-focus)]",
        dragging && "opacity-50 scale-[0.99]",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="block w-full text-left focus:outline-none"
        aria-label={`Open ${task.title}`}
      >
        <div className="flex items-start gap-2">
          <PriorityGlyph bucket={task.priorityBucket} />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-[13.5px] font-medium leading-[1.35] tracking-[-0.005em] text-[var(--fg)]",
                isDone && "text-[var(--fg-subtle)] line-through",
              )}
            >
              {task.title}
            </div>
            <AiStatusInline status={task.aiStatus} />
          </div>
        </div>
        {task.nextAction && !isDone ? (
          <p className="mt-2 line-clamp-2 text-[12px] leading-[1.45] text-[var(--fg-muted)]">
            {task.nextAction}
          </p>
        ) : null}
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={bucketTone(task.priorityBucket)}>
          {priorityShortLabel(task.priorityBucket)}
        </Badge>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {taskLabels.slice(0, 2).map((label) => (
          <Badge key={label.id} tone={label.tone}>
            {label.name}
          </Badge>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-[var(--border)]/70 pt-2">
        <span className="text-[11px] text-[var(--fg-subtle)]">Drag or move</span>
        <div className="flex items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={onMoveLeft}
            disabled={!canMoveLeft}
            aria-label={`Move ${task.title} left`}
            className="inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] disabled:opacity-25"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={onMoveRight}
            disabled={!canMoveRight}
            aria-label={`Move ${task.title} right`}
            className="inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] disabled:opacity-25"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

function priorityShortLabel(bucket: Task["priorityBucket"]): string {
  switch (bucket) {
    case "do_now":
      return "Now";
    case "schedule":
      return "Plan";
    case "delegate":
      return "Delegate";
    case "drop":
      return "Low";
    case "unset":
      return "Unset";
  }
}
