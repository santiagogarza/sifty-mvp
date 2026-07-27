"use client";

import { AiStatusInline } from "@/components/tasks/ai-status";
import { PriorityGlyph } from "@/components/tasks/priority-glyph";
import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check } from "lucide-react";
import * as React from "react";

/**
 * A single task as a board card.
 *
 * Anatomy (Figma "Board Card"): title (wraps to two lines), the AI next
 * action (one line, truncated), then a meta row — the priority glyph, a due
 * badge, and exactly one more badge (the assignee when the task is delegated
 * to a person, otherwise the first label). The whole card is the drag handle;
 * there is no grip glyph.
 *
 * The complete affordance shares the 16px glyph slot: the priority glyph at
 * rest, a completion circle on hover and on keyboard focus. Sharing one slot
 * means revealing the circle never reflows the card — important on a dense
 * board — and keeps the keyboard-first path from having a hover-only hole.
 */
export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Label[];
    selected?: boolean;
    /** Source card during a pointer drag — a dashed, faded placeholder. */
    ghost?: boolean;
    /** The floating copy under the cursor (rendered in dnd-kit's overlay). */
    overlay?: boolean;
    tabIndex?: number;
    onOpen: (id: string) => void;
    /** dnd-kit attributes + listeners, spread onto the draggable root. */
    dragProps?: React.HTMLAttributes<HTMLDivElement>;
  }
>(function BoardCard(
  { task, labels, selected, ghost, overlay, tabIndex = -1, onOpen, dragProps },
  ref,
) {
  const updateTask = useStore((s) => s.updateTask);

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const firstLabel = task.labelIds.map((id) => labelMap.get(id)).find(Boolean) as Label | undefined;
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  const isDone = task.lifecycle === "done";
  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, { lifecycle: isDone ? "active" : "done" });
  };

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={task.title}
      data-task-id={task.id}
      tabIndex={tabIndex}
      onClick={() => onOpen(task.id)}
      {...dragProps}
      className={cn(
        "group relative flex w-full cursor-grab flex-col gap-1 rounded-[var(--radius-md)]",
        "border border-[var(--border)] bg-[var(--surface)] px-3 py-2",
        "transition-[box-shadow,transform,border-color,opacity] duration-150 ease-[var(--ease-product)]",
        "hover:shadow-[0_4px_16px_-8px_oklch(0%_0_0/0.35)] hover:border-[var(--border-strong)]",
        "focus-visible:outline-none",
        selected && "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]",
        overlay && "cursor-grabbing rotate-[1.5deg] shadow-[0_16px_40px_-12px_oklch(0%_0_0/0.5)]",
        ghost && "border-dashed opacity-40",
        dragProps?.className,
      )}
    >
      <p
        className={cn(
          "line-clamp-2 text-[13px] leading-[18px] tracking-[-0.003em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </p>

      {task.nextAction && !isDone ? (
        <p className="truncate text-[12px] leading-[16px] text-[var(--fg-muted)]">
          {task.nextAction}
        </p>
      ) : null}

      <div className="mt-0.5 flex w-full items-center gap-1.5 overflow-hidden">
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {!isDone ? (
            <PriorityGlyph
              bucket={task.priorityBucket}
              className={cn(
                "transition-opacity duration-100",
                "group-hover:opacity-0 group-focus-within:opacity-0",
              )}
            />
          ) : null}
          <button
            type="button"
            onClick={onComplete}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full border",
              "transition-opacity duration-100",
              isDone
                ? "border-[var(--done)] bg-[var(--done)] opacity-100"
                : "border-[var(--fg-muted)]/60 bg-[var(--surface)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:border-[var(--accent)]",
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
          <Badge tone={firstLabel.tone} className="min-w-0 max-w-[130px]">
            <span className="truncate">{firstLabel.name}</span>
          </Badge>
        ) : null}

        <AiStatusInline status={task.aiStatus} className="ml-auto shrink-0" />
      </div>
    </div>
  );
});
