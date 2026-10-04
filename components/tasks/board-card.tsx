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

/**
 * The complete control shares the priority glyph's 12px slot so the card
 * doesn't reflow: glyph at rest, a 16px circle on hover or keyboard focus.
 * On a Done card the check stays visible.
 */
export function BoardCardFace({
  task,
  labels,
  overlay,
  selected,
  pulse,
  onComplete,
}: {
  task: Task;
  labels: Label[];
  overlay?: boolean;
  selected?: boolean;
  pulse?: boolean;
  onComplete?: () => void;
}) {
  const isDone = task.lifecycle === "done";
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const firstLabel = task.labelIds
    .map((id) => labelMap.get(id))
    .find((label): label is Label => Boolean(label));
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";

  return (
    <div
      className={cn(
        "group rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 py-2",
        "transition-[box-shadow,border-color] duration-150 ease-[var(--ease-product)]",
        overlay
          ? "w-[260px] cursor-grabbing border-[var(--border-strong)] shadow-[0_12px_28px_-12px_oklch(0%_0_0/0.35)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)] hover:shadow-[0_6px_16px_-10px_oklch(0%_0_0/0.28)]",
        selected && !overlay && "border-[var(--border-focus)]",
        pulse && "animate-fill-in",
      )}
    >
      <div
        className={cn(
          "line-clamp-2 text-[13px] leading-[1.35] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </div>
      {task.nextAction && !isDone ? (
        <div className="mt-0.5 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</div>
      ) : null}
      <AiStatusInline status={task.aiStatus} className="mt-1" />

      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <div className="relative size-3 shrink-0">
          {isDone ? null : (
            <span className="absolute inset-0 group-hover:opacity-0 group-focus-within:opacity-0">
              <PriorityGlyph bucket={task.priorityBucket} size={12} />
            </span>
          )}
          {onComplete ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              className={cn(
                "absolute left-1/2 top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border",
                "transition-opacity duration-150 ease-[var(--ease-product)]",
                isDone
                  ? "border-[var(--done)] bg-[var(--done)] text-white"
                  : "border-[var(--fg-muted)]/40 bg-[var(--surface)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {isDone ? <Check size={10} strokeWidth={3} /> : null}
            </button>
          ) : null}
        </div>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="min-w-0 max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : firstLabel ? (
          <Badge tone={firstLabel.tone} className="min-w-0 max-w-[120px]">
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
  selected,
  pulse,
  onOpen,
  onComplete,
  cardRef,
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  pulse: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    cardRef(node);
  };

  return (
    <div
      ref={setRefs}
      data-board-card=""
      data-task-id={task.id}
      {...listeners}
      {...attributes}
      role="option"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      onClick={() => onOpen(task.id)}
      className={cn("touch-manipulation cursor-grab outline-none", isDragging && "cursor-grabbing")}
    >
      <div className="relative">
        {isDragging ? (
          <div
            aria-hidden
            className="absolute inset-0 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)]"
          />
        ) : null}
        <div className={cn(isDragging && "invisible")}>
          <BoardCardFace
            task={task}
            labels={labels}
            selected={selected}
            pulse={pulse}
            onComplete={() => onComplete(task)}
          />
        </div>
      </div>
    </div>
  );
}
