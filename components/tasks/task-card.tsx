"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { useBoardDragGuard } from "./board-drag-context";
import { PriorityGlyph } from "./priority-glyph";

export const TaskCard = React.memo(function TaskCard({
  task,
  labels,
  onOpen,
  active,
  tabIndex = -1,
  isDragOverlay,
  uncompleteTo = "active",
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  active?: boolean;
  tabIndex?: number;
  isDragOverlay?: boolean;
  uncompleteTo?: Lifecycle;
}) {
  // Overlay clones must not call useDraggable — @dnd-kit already owns that id.
  if (isDragOverlay) {
    return (
      <TaskCardView
        task={task}
        labels={labels}
        onOpen={onOpen}
        active={active}
        tabIndex={tabIndex}
        isDragOverlay
        uncompleteTo={uncompleteTo}
      />
    );
  }
  return (
    <DraggableTaskCard
      task={task}
      labels={labels}
      onOpen={onOpen}
      active={active}
      tabIndex={tabIndex}
      uncompleteTo={uncompleteTo}
    />
  );
});

function DraggableTaskCard({
  task,
  labels,
  onOpen,
  active,
  tabIndex = -1,
  uncompleteTo = "active",
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  active?: boolean;
  tabIndex?: number;
  uncompleteTo?: Lifecycle;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task, lifecycle: task.lifecycle },
  });

  const style = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined;

  return (
    <TaskCardView
      task={task}
      labels={labels}
      onOpen={onOpen}
      active={active}
      tabIndex={tabIndex}
      uncompleteTo={uncompleteTo}
      dnd={{ setNodeRef, listeners, attributes, style, isDragging }}
    />
  );
}

function TaskCardView({
  task,
  labels,
  onOpen,
  active,
  tabIndex = -1,
  isDragOverlay,
  uncompleteTo = "active",
  dnd,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  active?: boolean;
  tabIndex?: number;
  isDragOverlay?: boolean;
  uncompleteTo?: Lifecycle;
  dnd?: Pick<
    ReturnType<typeof useDraggable>,
    "setNodeRef" | "listeners" | "attributes" | "isDragging"
  > & {
    style?: React.CSSProperties;
  };
}) {
  const updateTask = useStore((s) => s.updateTask);
  const { shouldSuppressClick } = useBoardDragGuard();

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, {
      lifecycle: task.lifecycle === "done" ? uncompleteTo : "done",
    });
  };

  const isDone = task.lifecycle === "done";
  const isDragging = dnd?.isDragging ?? false;

  return (
    <div
      ref={dnd?.setNodeRef}
      style={dnd?.style}
      {...(dnd?.listeners ?? {})}
      {...(dnd?.attributes ?? {})}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      onClick={() => {
        if (shouldSuppressClick(task.id)) return;
        if (!isDragging) onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative flex w-full flex-col gap-2 cursor-default touch-none",
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5",
        "transition-[box-shadow,background-color,border-color,opacity] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--fg-muted)]/30 hover:shadow-sm",
        active && "ring-2 ring-[var(--accent)]/40 border-[var(--accent)]/30",
        isDragging && !isDragOverlay && "opacity-40",
        isDragOverlay && "shadow-lg ring-2 ring-[var(--accent)]/30 cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onComplete}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "relative mt-0.5 size-5 shrink-0 rounded-full border flex items-center justify-center",
            "after:absolute after:-inset-1.5 after:content-['']",
            "transition-all duration-150 ease-[var(--ease-product)]",
            !isDone &&
              "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <PriorityGlyph bucket={task.priorityBucket} />
            <span
              className={cn(
                "truncate text-[13.5px] leading-[1.35] tracking-[-0.005em]",
                isDone
                  ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]"
                  : "text-[var(--fg)]",
              )}
            >
              {task.title}
            </span>
            <AiStatusInline status={task.aiStatus} />
          </div>
          {task.nextAction && !isDone ? (
            <div className="truncate text-[11.5px] text-[var(--fg-muted)] mt-0.5 pl-5">
              {task.nextAction}
            </div>
          ) : null}
        </div>
      </div>

      {(taskLabels.length > 0 || assignee || dueLabel) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-7">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[10.5px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {assignee ? (
            <Badge tone="neutral" variant="outline" className="max-w-[100px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : null}
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      )}
    </div>
  );
}

export type TaskCardUncompleteTo = Lifecycle;
