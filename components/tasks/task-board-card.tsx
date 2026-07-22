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

export function TaskBoardCard({
  task,
  labels,
  onOpen,
  isOverlay,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  isOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", task },
    disabled: isOverlay,
  });

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

  return (
    <div
      ref={isOverlay ? undefined : setNodeRef}
      style={
        isOverlay
          ? undefined
          : {
              transform: CSS.Translate.toString(transform),
            }
      }
      {...(isOverlay ? {} : { ...attributes, ...listeners })}
      onClick={() => {
        if (!isDragging) onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
        "shadow-[0_1px_2px_oklch(0%_0_0/0.04)]",
        "transition-[box-shadow,opacity,transform] duration-150 ease-[var(--ease-product)]",
        !isOverlay && "cursor-grab active:cursor-grabbing touch-none",
        isDragging && !isOverlay && "opacity-40",
        isOverlay && "shadow-lg rotate-[1deg] cursor-grabbing",
        !isDragging &&
          !isOverlay &&
          "hover:border-[var(--border-strong)] hover:shadow-[0_2px_8px_oklch(0%_0_0/0.06)]",
      )}
    >
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-start gap-2">
          <PriorityGlyph bucket={task.priorityBucket} className="mt-0.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-[1.35] tracking-[-0.005em] text-[var(--fg)]">
            {task.title}
          </span>
        </div>
        {task.nextAction ? (
          <p className="mt-1 line-clamp-1 pl-[22px] text-[11px] text-[var(--fg-muted)]">
            {task.nextAction}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <AiStatusInline status={task.aiStatus} />
          {taskLabels.slice(0, 1).map((label) => (
            <Badge key={label.id} tone={label.tone} className="max-w-[90px] truncate">
              {label.name}
            </Badge>
          ))}
        </div>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
