"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * A single board card — the Kanban counterpart to `TaskRow`.
 *
 * Kept purely presentational so the same markup renders in a column and in
 * the drag overlay, which is what makes the lift feel seamless. `dragging`
 * dims the card left behind in its column while the overlay floats.
 */
export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labelMap: Map<string, Label>;
    dragging?: boolean;
    overlay?: boolean;
    style?: React.CSSProperties;
    className?: string;
  } & React.HTMLAttributes<HTMLDivElement>
>(function BoardCard({ task, labelMap, dragging, overlay, style, className, ...rest }, ref) {
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
    <div
      ref={ref}
      style={style}
      className={cn(
        "group/card select-none rounded-[var(--radius-md)] border border-[var(--border)]",
        "bg-[var(--surface)] px-3 py-2.5 text-left",
        "transition-[border-color,box-shadow,transform] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] cursor-grab active:cursor-grabbing",
        overlay && "cursor-grabbing shadow-[0_12px_32px_-8px_oklch(0%_0_0/0.45)] rotate-[1.5deg]",
        dragging && "opacity-40",
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-2">
        <PriorityGlyph bucket={task.priorityBucket} />
        <AiStatusInline status={task.aiStatus} />
        <div className="ml-auto">
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      </div>

      <p
        className={cn(
          "mt-1.5 line-clamp-2 text-[13.5px] leading-[1.4] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </p>

      {task.nextAction && !isDone ? (
        <p className="mt-1 line-clamp-1 text-[12px] text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}

      {taskLabels.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {taskLabels.slice(0, 3).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 3 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
