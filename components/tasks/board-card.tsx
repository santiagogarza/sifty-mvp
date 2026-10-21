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
import { ConfidencePill } from "./confidence-pill";
import { PriorityPill } from "./priority-pill";
import { RepeatGlyph } from "./repeat-glyph";

/**
 * One draggable card. While it is being dragged its slot stays behind as a
 * dashed ghost (same height, so the column never reflows); the floating
 * copy is the board's DragOverlay.
 */
export const BoardCard = React.memo(function BoardCard({
  task,
  labelMap,
  selected,
  settling,
  onOpen,
  onSelect,
  onToggleComplete,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  selected: boolean;
  /** Just filed here: replay the fill-in so the eye finds where it landed. */
  settling: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleComplete: (task: Task) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-board-card={task.id}
      data-selected={selected || undefined}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      onFocus={() => onSelect(task.id)}
      className={cn(
        "group relative rounded-[var(--radius-md)] focus:outline-none [touch-action:manipulation]",
        isDragging &&
          "outline-1 outline-dashed -outline-offset-1 outline-[var(--border-strong)] bg-[var(--surface-muted)]",
      )}
    >
      <div className={cn(isDragging && "invisible")}>
        <BoardCardContent
          task={task}
          labelMap={labelMap}
          selected={selected}
          settling={settling}
          onToggleComplete={onToggleComplete}
        />
      </div>
    </div>
  );
});

export function BoardCardContent({
  task,
  labelMap,
  selected = false,
  settling = false,
  overlay = false,
  onToggleComplete,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  selected?: boolean;
  settling?: boolean;
  overlay?: boolean;
  onToggleComplete?: (task: Task) => void;
}) {
  const isDone = task.lifecycle === "done";
  const overdue = isOverdue(task.due);
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const firstLabel = task.labelIds.map((id) => labelMap.get(id)).find(Boolean) ?? null;

  return (
    <div
      className={cn(
        "surface-card relative rounded-[var(--radius-md)]",
        "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        overlay
          ? "border-[var(--accent)] shadow-lg"
          : selected
            ? "border-[var(--accent)]"
            : "hover:border-[var(--border-strong)]",
      )}
    >
      {/* The wash animates over the opaque card, so the card never goes see-through. */}
      <div className={cn("px-2.5 py-2", settling && "animate-fill-in")}>
        <span
          className={cn(
            "block min-w-0 pr-5 text-[13px] leading-[1.4] tracking-[-0.005em] line-clamp-2",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
        {task.nextAction && !isDone ? (
          <span className="mt-0.5 block truncate text-[12px] text-[var(--fg-muted)]">
            {task.nextAction}
          </span>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          <PriorityPill
            bucket={task.priorityBucket}
            urgency={task.urgency}
            importance={task.importance}
            compact
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
            <Badge tone={firstLabel.tone}>{firstLabel.name}</Badge>
          ) : null}
          {task.recurrence ? <RepeatGlyph rule={task.recurrence} /> : null}
          <ConfidencePill task={task} compact />
          <AiStatusInline status={task.aiStatus} stage={task.siftStage} />
        </div>
      </div>
      {onToggleComplete ? (
        <button
          type="button"
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          // Keep the press from arming a drag on the card underneath.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task);
          }}
          className={cn(
            "absolute top-2 right-2 flex size-4 items-center justify-center rounded-full border",
            "after:absolute after:-inset-1.5 after:content-['']",
            "transition-[opacity,background-color,border-color] duration-150 ease-[var(--ease-product)]",
            isDone
              ? "bg-[var(--done)] border-[var(--done)] opacity-100"
              : cn(
                  "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
                  "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
                  selected && "opacity-100",
                ),
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>
      ) : null}
    </div>
  );
}
