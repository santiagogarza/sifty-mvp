"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * One task on the board. Denser than `TaskRow` but built from the same
 * pieces (glyph, badges, AI status) so a task reads the same in both.
 *
 * The whole card is the drag handle, so the complete control shares the
 * glyph's slot instead of adding a column: at rest the glyph, on hover or
 * focus a 16px circle in the same box — no reflow when it appears.
 */
export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Label[];
    selected?: boolean;
    onSelect?: (id: string) => void;
    onOpen?: (id: string) => void;
    onComplete?: (id: string) => void;
    /** Rendered in the drag overlay: lifted look, no interaction. */
    lifted?: boolean;
    /** The source slot while its card is lifted: a dashed outline, content hidden. */
    ghost?: boolean;
    className?: string;
  } & Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect">
>(function BoardCard(
  { task, labels, selected, onSelect, onOpen, onComplete, lifted, ghost, className, ...rest },
  ref,
) {
  const isDone = task.lifecycle === "done";
  const due = task.due;
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = isOverdue(due)
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const firstLabel = assignee ? null : (labels.find((l) => l.id === task.labelIds[0]) ?? null);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected ?? false}
      aria-label={task.title}
      tabIndex={selected ? 0 : -1}
      onFocus={() => onSelect?.(task.id)}
      onClick={() => onOpen?.(task.id)}
      {...rest}
      className={cn(
        "group relative rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 py-2.5 text-left",
        "select-none cursor-grab active:cursor-grabbing touch-manipulation",
        "transition-[box-shadow,border-color] duration-150 ease-[var(--ease-product)]",
        "focus:outline-none",
        selected || lifted ? "border-[var(--accent)]" : "border-[var(--border)]",
        !ghost && "hover:shadow-[0_2px_8px_-2px_oklch(0%_0_0/0.14)]",
        lifted && "shadow-[0_12px_32px_-8px_oklch(0%_0_0/0.35)] cursor-grabbing",
        ghost && "border-dashed border-[var(--border-strong)] bg-transparent shadow-none",
        className,
      )}
    >
      <div className={cn("flex flex-col", ghost && "invisible")}>
        <div
          className={cn(
            "text-[13px] leading-[1.35] tracking-[-0.005em] line-clamp-2",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </div>
        {task.nextAction && !isDone ? (
          <div className="mt-0.5 truncate text-[12px] text-[var(--fg-muted)]">
            {task.nextAction}
          </div>
        ) : null}

        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            {!isDone ? (
              <PriorityGlyph
                bucket={task.priorityBucket}
                className="transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
              />
            ) : null}
            <button
              type="button"
              tabIndex={-1}
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              disabled={lifted || ghost}
              onClick={(e) => {
                e.stopPropagation();
                onComplete?.(task.id);
              }}
              onMouseDown={stop}
              onTouchStart={stop}
              onPointerDown={stop}
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full border",
                "transition-[opacity,border-color,background-color] duration-150 ease-[var(--ease-product)]",
                isDone
                  ? "bg-[var(--done)] border-[var(--done)]"
                  : cn(
                      "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                      "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40",
                      "hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
                    ),
              )}
            >
              {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
            </button>
          </span>

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
          <AiStatusInline status={task.aiStatus} className="ml-auto shrink-0" />
        </div>
      </div>
    </div>
  );
});
