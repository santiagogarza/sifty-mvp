"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * The card face, shared by the in-column draggable and the DragOverlay
 * clone so the lifted card is pixel-identical to the one it replaces.
 *
 * Composition mirrors TaskRow's hierarchy: title loudest, everything else
 * meta. No next-action line — board cards optimize for column scanning.
 */
export function BoardCardFace({
  task,
  labels,
  lifted,
}: {
  task: Task;
  labels: Label[];
  /** Overlay styling while the card is being dragged. */
  lifted?: boolean;
}) {
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";

  const hasMeta = taskLabels.length > 0 || dueLabel !== null;

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)]",
        "bg-[var(--surface)] px-3 py-2.5",
        lifted && "board-card-lift cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-[2.5px] shrink-0" />
        <span
          className={cn(
            "min-w-0 text-[13.5px] leading-[1.35] tracking-[-0.005em]",
            task.lifecycle === "done" ? "text-[var(--fg-muted)]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
      </div>
      <AiStatusInline status={task.aiStatus} className="pl-[22px]" />
      {hasMeta ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-[22px]">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Draggable wrapper. Mouse drags start after a 5px move and touch drags
 * after a long-press (see TaskBoard's sensor config) so a plain click
 * still opens the detail sheet and swipes still scroll; keyboard users
 * pick the card up with Space and open it with Enter.
 */
export function BoardCard({
  task,
  labels,
  onOpen,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  });

  // Space belongs to the drag sensor; Enter opens the sheet. Everything
  // else falls through to the sensor's own keydown handling.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(task.id);
      return;
    }
    listeners?.onKeyDown?.(e);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(task.id)}
      aria-roledescription="Draggable task card"
      className={cn(
        "cursor-grab touch-manipulation select-none",
        "transition-opacity duration-150 ease-[var(--ease-product)]",
        // The origin dims to a placeholder while the overlay carries the
        // lifted card, so where it came from stays legible.
        isDragging && "opacity-40",
      )}
    >
      <BoardCardFace task={task} labels={labels} />
    </div>
  );
}
