"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { ConfidencePill } from "./confidence-pill";
import { PriorityPill } from "./priority-pill";
import { RepeatGlyph } from "./repeat-glyph";

/**
 * Single task row.
 *
 * Hierarchy choices:
 *  - The title is the loudest element. Everything else is meta.
 *  - Priority sits on the left as a "spine" (a labeled pill, dot-only on
 *    phones) so scanning a list feels like reading column-aligned text;
 *    the due date and repeat mark sit on the right.
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
    /** Part of a Shift+click range selection. */
    selected?: boolean;
    /** Shift+click handler; when set, Shift+click selects instead of opening. */
    onRangeSelect?: (id: string) => void;
  }
>(function TaskRow(
  {
    task,
    onOpen,
    active,
    labels,
    tabIndex = -1,
    uncompleteTo = "active",
    selected = false,
    onRangeSelect,
  },
  ref,
) {
  const updateTask = useStore((s) => s.updateTask);

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
    updateTask(task.id, {
      lifecycle: task.lifecycle === "done" ? uncompleteTo : "done",
    });
  };

  const isDone = task.lifecycle === "done";

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={active || selected}
      data-selected={selected || undefined}
      tabIndex={tabIndex}
      onClick={(e) => {
        if (e.shiftKey && onRangeSelect) {
          onRangeSelect(task.id);
          return;
        }
        onOpen(task.id);
      }}
      // Shift+click would otherwise start a text selection across rows.
      onMouseDown={(e) => {
        if (e.shiftKey && onRangeSelect) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative grid w-full items-center gap-3 cursor-default",
        "grid-cols-[24px_auto_1fr_auto] sm:grid-cols-[24px_auto_1fr_auto_auto]",
        "rounded-[var(--radius-md)] px-2.5 py-2.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "hover:bg-[var(--surface-muted)]",
        active && "bg-[var(--surface-muted)]",
        selected && "bg-[var(--surface-hover)] shadow-[inset_2px_0_0_var(--accent)]",
      )}
    >
      <button
        type="button"
        onClick={onComplete}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        className={cn(
          // The visible circle is 20px; the ::after pseudo pads the hit
          // target to ~32px (Fitts) without changing the layout.
          "relative size-5 rounded-full border flex items-center justify-center",
          "after:absolute after:-inset-1.5 after:content-['']",
          "transition-all duration-150 ease-[var(--ease-product)]",
          !isDone &&
            "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
          isDone && "bg-[var(--done)] border-[var(--done)]",
        )}
      >
        {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
      </button>

      {/* An unranked task renders no pill; the empty cell keeps the title column aligned. */}
      <span className="flex min-w-[6px] items-center">
        <PriorityPill
          bucket={task.priorityBucket}
          urgency={task.urgency}
          importance={task.importance}
          compact
        />
      </span>

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
          <AiStatusInline status={task.aiStatus} stage={task.siftStage} />
          <ConfidencePill task={task} compact />
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
        {task.recurrence ? <RepeatGlyph rule={task.recurrence} /> : null}
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
      </div>
    </div>
  );
});
