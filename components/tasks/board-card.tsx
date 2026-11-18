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
 * One board card.
 *
 * The whole card is the drag handle — no grip icon. The complete control
 * shares the priority glyph's 12px slot and only appears on hover or
 * focus, so the card does not reflow. On a Done card the check stays
 * visible.
 */
export function BoardCard({
  task,
  labels,
  selected,
  justFiled,
  onOpen,
  onComplete,
  cardRef,
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  justFiled: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  cardRef?: (node: HTMLDivElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { lifecycle: task.lifecycle },
  });
  const cardRefLatest = React.useRef(cardRef);
  cardRefLatest.current = cardRef;

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      cardRefLatest.current?.(node);
    },
    [setNodeRef],
  );

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      role="article"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      className={cn(
        "group rounded-[var(--radius-md)] outline-none [touch-action:manipulation]",
        "cursor-grab active:cursor-grabbing",
        isDragging && "border border-dashed border-[var(--border-strong)]",
        selected && "shadow-[inset_0_0_0_1px_var(--border-focus)]",
      )}
    >
      <BoardCardContent
        task={task}
        labels={labels}
        justFiled={justFiled}
        hidden={isDragging}
        onComplete={onComplete}
      />
    </div>
  );
}

export function BoardCardContent({
  task,
  labels,
  justFiled = false,
  hidden = false,
  overlay = false,
  onComplete,
}: {
  task: Task;
  labels: Label[];
  justFiled?: boolean;
  hidden?: boolean;
  overlay?: boolean;
  onComplete?: (task: Task) => void;
}) {
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const firstLabel = task.labelIds.map((id) => labelMap.get(id)).find(Boolean) ?? null;
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const isDone = task.lifecycle === "done";

  return (
    <div
      className={cn(
        "surface-card rounded-[var(--radius-md)] px-2.5 py-2",
        "transition-[transform,box-shadow] duration-150 ease-[var(--ease-product)]",
        !overlay &&
          !hidden &&
          "group-hover:-translate-y-px group-hover:shadow-[0_6px_16px_-10px_color-mix(in_oklch,var(--fg)_28%,transparent)]",
        overlay && "scale-[1.02] shadow-lg",
        justFiled && "animate-fill-in",
        hidden && "invisible",
      )}
    >
      <span
        className={cn(
          "block text-[13px] leading-[1.4] tracking-[-0.005em] line-clamp-2",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </span>
      {task.nextAction && !isDone ? (
        <p className="mt-1 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <CompleteSlot task={task} isDone={isDone} onComplete={onComplete} />
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : firstLabel ? (
          <Badge tone={firstLabel.tone}>{firstLabel.name}</Badge>
        ) : null}
        <AiStatusInline status={task.aiStatus} />
      </div>
    </div>
  );
}

function CompleteSlot({
  task,
  isDone,
  onComplete,
}: {
  task: Task;
  isDone: boolean;
  onComplete?: (task: Task) => void;
}) {
  return (
    <span className="relative size-3 shrink-0">
      <PriorityGlyph
        bucket={task.priorityBucket}
        className={cn(
          "transition-opacity duration-150",
          isDone ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0",
        )}
      />
      {onComplete ? (
        <button
          type="button"
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onComplete(task);
          }}
          className={cn(
            "absolute left-1/2 top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border",
            "transition-opacity duration-150 ease-[var(--ease-product)]",
            isDone
              ? "border-[var(--done)] bg-[var(--done)] opacity-100"
              : "border-[var(--fg-muted)]/40 bg-[var(--surface)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>
      ) : null}
    </span>
  );
}
