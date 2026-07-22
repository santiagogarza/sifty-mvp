"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export function BoardCard({
  task,
  labels,
  onOpen,
  overlay = false,
  reducedMotion = false,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  overlay?: boolean;
  reducedMotion?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  });

  const { onKeyDown: draggableKeyDown, ...restListeners } = listeners ?? {};

  const style = overlay
    ? undefined
    : transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : restListeners)}
      onClick={() => {
        if (!isDragging) onOpen(task.id);
      }}
      onKeyDown={(e) => {
        draggableKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !isDragging) {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
        "px-3 py-2.5 touch-none select-none",
        "transition-[opacity,box-shadow] duration-200 ease-[var(--ease-product)]",
        isDragging && !overlay && "transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
        !overlay && "cursor-grab active:cursor-grabbing",
        isDragging && !overlay && "opacity-40",
        overlay &&
          !reducedMotion &&
          "scale-[1.03] shadow-[0_12px_40px_-8px_oklch(0%_0_0/0.35)] cursor-grabbing",
        overlay && reducedMotion && "shadow-[0_4px_12px_-4px_oklch(0%_0_0/0.25)]",
      )}
    >
      <BoardCardContent task={task} labels={labels} />
    </div>
  );
}

function BoardCardContent({ task, labels }: { task: Task; labels: Label[] }) {
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
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
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2 min-w-0">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "text-[13.5px] leading-[1.35] tracking-[-0.005em] line-clamp-2",
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
            <div className="truncate text-[12px] text-[var(--fg-muted)] mt-0.5">
              {task.nextAction}
            </div>
          ) : null}
        </div>
      </div>

      {(taskLabels.length > 0 || dueLabel) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
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
