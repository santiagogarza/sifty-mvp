"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * Payload carried on the active draggable so drop handling and screen-reader
 * announcements never have to re-find the task in the store mid-drag.
 */
export interface BoardDragData {
  title: string;
  status: Lifecycle;
}

/**
 * A task on the board. The whole card is the drag handle (one affordance,
 * no grip chrome); a plain click or Enter opens the detail sheet, exactly
 * like a list row. While dragging, the source card stays in place as a
 * dimmed placeholder and a lifted copy follows the pointer via DragOverlay.
 */
export function BoardCard({
  task,
  labelMap,
  onOpen,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { title: task.title, status: task.lifecycle } satisfies BoardDragData,
  });
  const { onKeyDown: dragKeyDown, ...dragListeners } = listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...dragListeners}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        // The keyboard sensor owns Space (pick up / drop) and prevents
        // default when it activates; Enter stays free to open the task.
        dragKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "select-none touch-manipulation rounded-[var(--radius-md)]",
        isDragging && "opacity-35",
      )}
    >
      <BoardCardContent task={task} labelMap={labelMap} />
    </div>
  );
}

/**
 * Pure card visuals, shared by the in-column card and the DragOverlay copy.
 * `lifted` is the held state: raised shadow, slight scale, grabbing cursor.
 * The lift-in animation lives in globals.css (`.board-card-lifted`); the
 * settle-back-down half runs in the drop animation in task-board.tsx.
 */
export function BoardCardContent({
  task,
  labelMap,
  lifted,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  lifted?: boolean;
}) {
  const isDone = task.lifecycle === "done";
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = isOverdue(task.due)
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 py-2.5",
        "shadow-[0_1px_2px_oklch(0%_0_0/0.04)]",
        lifted
          ? "board-card-lifted cursor-grabbing border-[var(--border-strong)]"
          : "border-[var(--border)] transition-colors duration-150 ease-[var(--ease-product)] hover:border-[var(--border-strong)]",
      )}
    >
      <div
        className={cn(
          "line-clamp-2 text-[13.5px] leading-[1.4] tracking-[-0.005em]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </div>
      {task.nextAction && !isDone ? (
        <div className="mt-1 truncate text-[12px] text-[var(--fg-muted)]">{task.nextAction}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityGlyph bucket={task.priorityBucket} />
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {assignee ? (
          <Badge tone="neutral" variant="outline" className="max-w-[120px]">
            <span className="truncate">{assignee}</span>
          </Badge>
        ) : null}
        {taskLabels.slice(0, 2).map((label) => (
          <Badge key={label.id} tone={label.tone}>
            {label.name}
          </Badge>
        ))}
        {taskLabels.length > 2 ? (
          <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
        ) : null}
        <AiStatusInline status={task.aiStatus} />
      </div>
    </div>
  );
}
