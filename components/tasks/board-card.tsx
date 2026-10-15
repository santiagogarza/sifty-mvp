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
 * Board card. The whole card is the drag handle; the priority glyph's slot
 * doubles as the complete control (shown on hover/focus, always on Done).
 */
export const BoardCard = React.memo(
  React.forwardRef<
    HTMLDivElement,
    {
      task: Task;
      labelsById: ReadonlyMap<string, Label>;
      selected?: boolean;
      /** Rendered inside the DragOverlay: lifted, never interactive. */
      overlay?: boolean;
      /** Just filed here: plays the settle animation once on mount. */
      settling?: boolean;
      onOpen?: (id: string) => void;
      onToggleComplete?: (task: Task) => void;
    } & React.HTMLAttributes<HTMLDivElement>
  >(function BoardCard(
    { task, labelsById, selected, overlay, settling, onOpen, onToggleComplete, className, ...rest },
    ref,
  ) {
    const isDone = task.lifecycle === "done";
    const dueLabel = formatRelativeDay(task.due);
    const dueTone: "rose" | "ember" | "neutral" = isOverdue(task.due)
      ? "rose"
      : isToday(task.due)
        ? "ember"
        : "neutral";
    const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
    const firstLabel = assignee ? null : labelsById.get(task.labelIds[0] ?? "");

    return (
      <div
        ref={ref}
        data-task-id={task.id}
        onClick={overlay ? undefined : () => onOpen?.(task.id)}
        className={cn(
          "group relative rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 py-2",
          "select-none [-webkit-touch-callout:none] focus:outline-none",
          "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
          selected || overlay
            ? "border-[var(--accent)]"
            : "border-[var(--border)] hover:border-[var(--border-strong)]",
          overlay
            ? "rotate-1 shadow-[0_12px_28px_-8px_oklch(0%_0_0/0.28)]"
            : "shadow-[0_1px_2px_oklch(0%_0_0/0.04)]",
          settling && "animate-fill-in",
          className,
        )}
        {...rest}
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
          <div className="truncate text-[12px] text-[var(--fg-muted)] mt-0.5">
            {task.nextAction}
          </div>
        ) : null}

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <PriorityGlyph
              bucket={task.priorityBucket}
              className={cn(
                "transition-opacity duration-150",
                isDone ? "opacity-0" : "group-hover:opacity-0 group-focus-within:opacity-0",
              )}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleComplete?.(task);
              }}
              className={cn(
                "absolute inset-0 rounded-full border flex items-center justify-center",
                "after:absolute after:-inset-1.5 after:content-['']",
                "transition-[opacity,background-color,border-color] duration-150 ease-[var(--ease-product)]",
                isDone
                  ? "bg-[var(--done)] border-[var(--done)]"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
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
            <Badge tone="neutral" variant="outline" className="max-w-[120px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : firstLabel ? (
            <Badge tone={firstLabel.tone} className="max-w-[120px]">
              <span className="truncate">{firstLabel.name}</span>
            </Badge>
          ) : null}
          <AiStatusInline status={task.aiStatus} />
        </div>
      </div>
    );
  }),
);

/**
 * A card wired to dnd-kit. While its own drag is in flight it renders as a
 * dashed ghost holding its slot; the lifted copy lives in the DragOverlay.
 */
export const DraggableBoardCard = React.memo(function DraggableBoardCard({
  task,
  labelsById,
  selected,
  settling,
  onOpen,
  onToggleComplete,
  registerRef,
}: {
  task: Task;
  labelsById: ReadonlyMap<string, Label>;
  selected: boolean;
  settling: boolean;
  onOpen: (id: string) => void;
  onToggleComplete: (task: Task) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { from: task.lifecycle },
  });
  const ref = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      registerRef(task.id, el);
    },
    [setNodeRef, registerRef, task.id],
  );

  return (
    <BoardCard
      ref={ref}
      task={task}
      labelsById={labelsById}
      selected={selected}
      settling={settling}
      onOpen={onOpen}
      onToggleComplete={onToggleComplete}
      {...attributes}
      {...listeners}
      tabIndex={selected ? 0 : -1}
      className={cn(
        isDragging &&
          "border-dashed border-[var(--border-strong)] bg-transparent shadow-none [&>*]:invisible",
      )}
    />
  );
});
