"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export function BoardCardFace({
  task,
  labels,
  className,
  selected = false,
  overlay = false,
  onComplete,
}: {
  task: Task;
  labels: Label[];
  className?: string;
  selected?: boolean;
  overlay?: boolean;
  onComplete?: (task: Task) => void;
}) {
  const isDone = task.lifecycle === "done";
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const firstLabel = task.labelIds
    .map((id) => labelMap.get(id))
    .find((label): label is Label => Boolean(label));
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone = overdue ? "rose" : isToday(task.due) ? "ember" : "neutral";

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5",
        selected && "ring-1 ring-[var(--border-focus)]",
        overlay && "shadow-[0_8px_24px_oklch(0%_0_0/0.12)]",
        className,
      )}
    >
      <h3
        className={cn(
          "line-clamp-2 break-words text-[13px] leading-[1.35] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </h3>
      <AiStatusInline status={task.aiStatus} className="mt-1" />
      {task.nextAction && !isDone ? (
        <p className="mt-1 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <div className="relative size-4 shrink-0">
          {isDone ? null : (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
              <PriorityGlyph bucket={task.priorityBucket} size={12} />
            </span>
          )}
          {onComplete ? (
            <button
              type="button"
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onComplete(task);
              }}
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full border",
                "transition-opacity duration-150 ease-[var(--ease-product)]",
                isDone
                  ? "border-[var(--done)] bg-[var(--done)] opacity-100"
                  : "border-[var(--fg-muted)]/40 bg-[var(--surface)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
            </button>
          ) : (
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full border",
                isDone ? "border-[var(--done)] bg-[var(--done)]" : "hidden",
              )}
              aria-hidden
            >
              {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
            </span>
          )}
        </div>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="min-w-0">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : firstLabel ? (
          <Badge tone={firstLabel.tone} className="min-w-0">
            <span className="truncate">{firstLabel.name}</span>
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

export function BoardCard({
  task,
  labels,
  selected = false,
  settled = false,
  ignoreClick,
  onOpen,
  onComplete,
  onSelect,
}: {
  task: Task;
  labels: Label[];
  selected?: boolean;
  settled?: boolean;
  ignoreClick?: React.MutableRefObject<boolean>;
  onOpen?: (id: string) => void;
  onComplete?: (task: Task) => void;
  onSelect?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  const open = () => {
    if (ignoreClick?.current) {
      ignoreClick.current = false;
      return;
    }
    onSelect?.(task.id);
    onOpen?.(task.id);
  };

  return (
    <div
      id={`board-card-${task.id}`}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="listitem"
      aria-current={selected ? "true" : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onSelect?.(task.id);
          onOpen?.(task.id);
        }
      }}
      className={cn(
        "group relative w-full min-w-0 cursor-grab select-none touch-manipulation",
        "transition-[transform,box-shadow] duration-150 ease-[var(--ease-product)]",
        "hover:-translate-y-px",
        "focus-visible:outline-none",
        settled && "animate-fill-in",
        isDragging && "h-[88px]",
      )}
    >
      {isDragging ? (
        <div className="h-[88px] rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)]" />
      ) : (
        <BoardCardFace task={task} labels={labels} selected={selected} onComplete={onComplete} />
      )}
    </div>
  );
}
