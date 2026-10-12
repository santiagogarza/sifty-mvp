"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, PriorityBucket, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export function BoardCardFace({
  task,
  labels,
  selected = false,
  landed = false,
  dragging = false,
  setNodeRef,
  listeners,
  onOpen,
  onComplete,
}: {
  task: Task;
  labels: Label[];
  selected?: boolean;
  landed?: boolean;
  dragging?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  listeners?: DraggableSyntheticListeners;
  onOpen?: (id: string) => void;
  onComplete?: (task: Task) => void;
}) {
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const firstLabel = task.labelIds.map((id) => labelMap.get(id)).find(Boolean) as Label | undefined;
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

  return (
    <article
      ref={setNodeRef}
      id={`board-card-${task.id}`}
      aria-selected={selected}
      {...listeners}
      onClick={() => onOpen?.(task.id)}
      className={cn(
        "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2",
        "cursor-grab active:cursor-grabbing",
        dragging && "border-dashed opacity-50",
        selected && "ring-1 ring-[var(--border-focus)]",
        landed && "animate-fill-in",
      )}
    >
      <h3
        className={cn(
          "line-clamp-2 text-[13px] leading-[1.35] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </h3>
      {task.nextAction && !isDone ? (
        <p className="mt-0.5 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        <CompleteSlot
          bucket={task.priorityBucket}
          done={isDone}
          revealed={selected}
          onComplete={() => onComplete?.(task)}
        />
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
          <Badge tone={firstLabel.tone} className="max-w-[120px]">
            <span className="truncate">{firstLabel.name}</span>
          </Badge>
        ) : null}
      </div>
      <AiStatusInline status={task.aiStatus} className="mt-1" />
    </article>
  );
}

function CompleteSlot({
  bucket,
  done,
  revealed,
  onComplete,
}: {
  bucket: PriorityBucket;
  done: boolean;
  revealed: boolean;
  onComplete: () => void;
}) {
  return (
    <span className="relative size-4 shrink-0">
      <PriorityGlyph
        bucket={bucket}
        className={cn(
          "pointer-events-none absolute inset-0 m-auto",
          "group-hover:invisible group-focus-within:invisible",
          (done || revealed) && "invisible",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full border",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          "focus-visible:opacity-100 focus-visible:outline-none",
          done
            ? "border-[var(--done)] bg-[var(--done)] opacity-100"
            : "border-[var(--fg-muted)]/40 bg-[var(--surface)]",
          revealed && !done && "opacity-100",
        )}
      >
        {done ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
      </button>
    </span>
  );
}
