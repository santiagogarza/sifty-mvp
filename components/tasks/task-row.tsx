"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * Border color for the incomplete completion circle. Set via inline style
 * (not a Tailwind class) because the global unlayered `* { border-color }`
 * reset outranks layered border utilities and would otherwise flatten it to
 * the near-invisible `--border`. `--fg-muted` at 55% reads as a calm but
 * clearly present ring in both themes.
 */
export const INCOMPLETE_CIRCLE_BORDER = "color-mix(in oklab, var(--fg-muted) 55%, transparent)";

/**
 * Single task row.
 *
 * Hierarchy choices:
 *  - The title is the loudest element. Everything else is meta.
 *  - Priority and due date sit on the left as a "spine" so scanning a list
 *    feels like reading column-aligned text.
 *  - Labels collapse to a single line and truncate gracefully.
 *  - The complete-button is a real <button> with a 32px hit target.
 */
export const TaskRow = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    onOpen: (id: string) => void;
    active?: boolean;
    labels: Label[];
    tabIndex?: number;
    /**
     * Status to restore when un-completing. Completion ghosts pass the
     * status the task had before it was checked off, so a quick uncheck
     * puts it back exactly where it was.
     */
    uncompleteTo?: Lifecycle;
  }
>(function TaskRow({ task, onOpen, active, labels, tabIndex = -1, uncompleteTo = "active" }, ref) {
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

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const isDone = task.lifecycle === "done";

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative grid w-full items-center gap-3 cursor-default",
        "grid-cols-[24px_14px_1fr_auto] sm:grid-cols-[24px_14px_1fr_auto_auto]",
        "rounded-[var(--radius-md)] px-2.5 py-2.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "hover:bg-[var(--surface-muted)]",
        active && "bg-[var(--surface-muted)]",
      )}
    >
      <button
        type="button"
        onClick={onComplete}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        // The border color is set inline for the incomplete state: the global
        // unlayered `* { border-color: var(--border) }` reset in globals.css
        // outranks Tailwind's layered border utilities, so a `border-…` class
        // here silently renders as the near-invisible `--border`, leaving the
        // circle unclickable-looking. An inline value beats the reset.
        style={isDone ? undefined : { borderColor: INCOMPLETE_CIRCLE_BORDER }}
        className={cn(
          // The visible circle is 20px; the ::after pseudo pads the hit
          // target to ~32px (Fitts) without changing the layout.
          "relative size-5 rounded-full border flex items-center justify-center",
          "after:absolute after:-inset-1.5 after:content-['']",
          "transition-all duration-150 ease-[var(--ease-product)]",
          !isDone && "bg-[var(--surface-muted)] hover:bg-[var(--surface-hover)]",
          isDone && "bg-[var(--done)] border-[var(--done)]",
        )}
      >
        {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
      </button>

      <PriorityGlyph bucket={task.priorityBucket} />

      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[14px] leading-[1.35] tracking-[-0.005em]",
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
          <div className="truncate text-[12px] text-[var(--fg-muted)] mt-0.5">
            {task.nextAction}
          </div>
        ) : null}
      </div>

      <div className="hidden sm:flex items-center gap-1.5 max-w-[220px] overflow-hidden">
        {taskLabels.slice(0, 2).map((label) => (
          <Badge key={label.id} tone={label.tone}>
            {label.name}
          </Badge>
        ))}
        {taskLabels.length > 2 ? (
          <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 justify-end">
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="hidden sm:inline-flex max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : null}
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  );
});
