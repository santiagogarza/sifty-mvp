"use client";

import { AiStatusInline } from "@/components/tasks/ai-status";
import { PriorityGlyph } from "@/components/tasks/priority-glyph";
import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import * as React from "react";

interface BoardCardProps {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
}

export function BoardCard({ task, labels, onOpen }: BoardCardProps) {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: task.id,
    data: { lifecycle: task.lifecycle },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={cn(
        "block w-full cursor-grab rounded-[var(--radius-md)] text-left active:cursor-grabbing",
        "transition-opacity duration-150 ease-[var(--ease-product)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
        isDragging && "opacity-40",
      )}
    >
      <BoardCardContent task={task} labels={labels} />
    </button>
  );
}

export function BoardCardPreview({
  task,
  labels,
  elevated = true,
}: {
  task: Task;
  labels: Label[];
  elevated?: boolean;
}) {
  return (
    <div
      className={cn(
        "w-full cursor-grabbing rounded-[var(--radius-md)]",
        elevated &&
          "scale-[1.03] shadow-[0_18px_40px_-18px_oklch(0%_0_0/0.42),0_4px_12px_-6px_oklch(0%_0_0/0.24)]",
      )}
    >
      <BoardCardContent task={task} labels={labels} overlay />
    </div>
  );
}

function BoardCardContent({
  task,
  labels,
  overlay = false,
}: {
  task: Task;
  labels: Label[];
  overlay?: boolean;
}) {
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";

  return (
    <div
      className={cn(
        "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3",
        "transition-[background,border-color,box-shadow,transform] duration-150 ease-[var(--ease-product)]",
        !overlay &&
          "hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] hover:shadow-[0_4px_14px_-10px_oklch(0%_0_0/0.32)]",
        overlay && "border-[var(--border-strong)] bg-[var(--bg-elevated)]",
      )}
    >
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] leading-[1.4] tracking-[-0.005em] text-[var(--fg)]">
            {task.title}
          </div>
          <AiStatusInline status={task.aiStatus} className="mt-1" />
        </div>
        <span className="-mr-2 -mt-2 flex size-8 shrink-0 touch-none items-center justify-center text-[var(--fg-subtle)] opacity-45 transition-opacity group-hover:opacity-80">
          <GripVertical size={14} aria-hidden="true" />
        </span>
      </div>

      {taskLabels.length > 0 || dueLabel ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {dueLabel ? (
            <Badge
              tone={dueTone}
              variant={dueTone === "neutral" ? "outline" : "soft"}
              className="ml-auto"
            >
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
