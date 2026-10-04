"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export function BoardCard({
  task,
  labelById,
  selected,
  landed,
  onOpen,
  onComplete,
}: {
  task: Task;
  labelById: Map<string, Label>;
  selected: boolean;
  landed: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const firstLabel = task.labelIds.map((id) => labelById.get(id)).find((label) => label) ?? null;

  return (
    <div
      ref={setNodeRef}
      className={cn("relative", landed && "animate-fill-in")}
      {...listeners}
      {...attributes}
      role="option"
      id={`card-${task.id}`}
      aria-selected={selected}
      aria-roledescription="draggable"
      tabIndex={-1}
      onClick={() => onOpen(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(task.id);
      }}
    >
      <BoardCardFace
        task={task}
        firstLabel={firstLabel ?? null}
        selected={selected}
        onComplete={onComplete}
        className={cn(isDragging && "invisible")}
      />
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)]" />
      ) : null}
    </div>
  );
}

export function BoardCardFace({
  task,
  firstLabel,
  selected,
  onComplete,
  className,
  lifted = false,
}: {
  task: Task;
  firstLabel: Label | null;
  selected?: boolean;
  onComplete?: (task: Task) => void;
  className?: string;
  lifted?: boolean;
}) {
  const isDone = task.lifecycle === "done";
  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const showAi =
    task.aiStatus === "pending" || task.aiStatus === "running" || task.aiStatus === "failed";
  const revealComplete = isDone || selected;

  return (
    <div
      className={cn(
        "group cursor-grab rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5",
        "shadow-[0_1px_2px_oklch(0%_0_0/0.04)]",
        "transition-[transform,box-shadow] duration-150 ease-[var(--ease-product)]",
        "hover:-translate-y-px hover:shadow-[0_4px_12px_oklch(0%_0_0/0.06)]",
        selected && "bg-[var(--surface-hover)]",
        isDone && "opacity-80",
        lifted && "cursor-grabbing shadow-[0_8px_24px_oklch(0%_0_0/0.12)]",
        className,
      )}
    >
      <p
        className={cn(
          "line-clamp-2 text-[13px] leading-[1.35] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </p>
      {showAi ? (
        <div className="mt-1">
          <AiStatusInline status={task.aiStatus} />
        </div>
      ) : null}
      {task.nextAction && !isDone ? (
        <p className="mt-1 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="relative size-3 shrink-0">
          <PriorityGlyph
            bucket={task.priorityBucket}
            className={cn(
              "transition-opacity duration-150",
              revealComplete ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0",
            )}
          />
          <button
            type="button"
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onComplete?.(task);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            }}
            className={cn(
              "absolute left-1/2 top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border",
              "transition-opacity duration-150",
              isDone
                ? "border-[var(--done)] bg-[var(--done)] opacity-100"
                : "border-[var(--fg-muted)]/40 bg-[var(--surface)]",
              !isDone &&
                (revealComplete
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"),
            )}
          >
            {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
          </button>
        </div>
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
      </div>
    </div>
  );
}
