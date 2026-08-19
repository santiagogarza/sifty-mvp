"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export const TaskCard = React.memo(
  React.forwardRef<
    HTMLDivElement,
    {
      task: Task;
      onOpen: (id: string) => void;
      onSelect?: (id: string) => void;
      active?: boolean;
      labels: Label[];
      isOverlay?: boolean;
    }
  >(function TaskCard({ task, onOpen, onSelect, active, labels, isOverlay }, ref) {
    const updateTask = useStore((s) => s.updateTask);

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: task.id,
      data: { task },
    });

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

    const isDone = task.lifecycle === "done";

    const onComplete = (e: React.MouseEvent) => {
      e.stopPropagation();
      updateTask(task.id, {
        lifecycle: isDone ? "active" : "done",
      });
    };

    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        }
      : undefined;

    return (
      <div
        ref={(node) => {
          setNodeRef(node);
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        style={style}
        {...attributes}
        {...listeners}
        role="option"
        tabIndex={active ? 0 : -1}
        aria-selected={active}
        onClick={(e) => {
          // Prevent opening if we just dragged (handled by pointer sensor distance, but just in case)
          if (!isDragging) {
            onSelect?.(task.id);
            onOpen(task.id);
          }
        }}
        className={cn(
          "group relative flex flex-col gap-2 w-full cursor-grab active:cursor-grabbing",
          "rounded-[var(--radius-md)] border bg-[var(--surface)] p-3 shadow-sm",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          "hover:border-[var(--border-hover)]",
          active && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
          isDragging && !isOverlay && "opacity-50",
          isOverlay && "shadow-lg rotate-2 scale-105 cursor-grabbing z-50",
        )}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onComplete}
            onPointerDown={(e) => e.stopPropagation()} // Prevent drag start on complete button
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            className={cn(
              "relative size-5 shrink-0 rounded-full border flex items-center justify-center mt-0.5",
              "after:absolute after:-inset-1.5 after:content-['']",
              "transition-all duration-150 ease-[var(--ease-product)]",
              !isDone &&
                "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
              isDone && "bg-[var(--done)] border-[var(--done)]",
            )}
          >
            {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
          </button>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-[14px] leading-[1.35] tracking-[-0.005em] break-words",
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
              <div className="text-[12px] text-[var(--fg-muted)] line-clamp-2">
                {task.nextAction}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 mt-0.5">
            <PriorityGlyph bucket={task.priorityBucket} />
          </div>
        </div>

        {(taskLabels.length > 0 || assignee || dueLabel) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {taskLabels.map((label) => (
              <Badge key={label.id} tone={label.tone}>
                {label.name}
              </Badge>
            ))}
            {assignee ? (
              <Badge tone="neutral" variant="outline" className="max-w-[120px]">
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
  }),
);
