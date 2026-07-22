"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check, GripVertical } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export const TaskBoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Label[];
    active?: boolean;
    dragging?: boolean;
    tabIndex?: number;
    onOpen: (id: string) => void;
    onPointerDownDrag?: (e: React.PointerEvent<HTMLDivElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
    onFocus?: () => void;
  }
>(function TaskBoardCard(
  { task, labels, active, dragging, tabIndex = -1, onOpen, onPointerDownDrag, onKeyDown, onFocus },
  ref,
) {
  const updateTask = useStore((s) => s.updateTask);
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

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, {
      lifecycle: isDone ? "active" : "done",
    });
  };

  return (
    <div
      ref={ref}
      role="listitem"
      tabIndex={tabIndex}
      data-task-id={task.id}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onPointerDown={onPointerDownDrag}
      className={cn(
        "group relative flex cursor-grab flex-col gap-1.5 rounded-[var(--radius-md)]",
        "border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2.5",
        "shadow-[0_1px_0_oklch(0%_0_0/0.03)]",
        "transition-[background,border-color,box-shadow,opacity,transform] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
        "active:cursor-grabbing",
        active && "border-[var(--border-strong)] bg-[var(--surface-muted)]",
        dragging && "opacity-40 touch-none",
        isDone && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onComplete}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "mt-0.5 size-4 shrink-0 rounded-full border flex items-center justify-center",
            "transition-[background,border-color] duration-150 ease-[var(--ease-product)]",
            "border-[var(--border-strong)] hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <PriorityGlyph bucket={task.priorityBucket} size={10} />
            <span
              className={cn(
                "min-w-0 flex-1 text-[13px] leading-[1.35] tracking-[-0.005em]",
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
            <div className="mt-1 truncate pl-[16px] text-[11.5px] text-[var(--fg-muted)]">
              {task.nextAction}
            </div>
          ) : null}
        </div>

        <GripVertical
          size={12}
          className="mt-0.5 shrink-0 text-[var(--fg-subtle)] opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
          aria-hidden
        />
      </div>

      {(dueLabel || taskLabels.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 pl-[24px]">
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
          {taskLabels.slice(0, 1).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 1 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 1}</span>
          ) : null}
        </div>
      )}
    </div>
  );
});
