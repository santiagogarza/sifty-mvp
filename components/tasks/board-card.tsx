"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * A single board card — the draggable atom of the Kanban view.
 *
 * It composes the same sub-parts a `TaskRow` uses (`PriorityGlyph`, title,
 * `AiStatusInline`, label + due `Badge`s) but in a stacked card layout that
 * reads well inside a narrow column.
 *
 * Two render paths share `BoardCardBody`:
 *  - the in-column draggable (`BoardCard`), and
 *  - the lifted `DragOverlay` clone (`BoardCardOverlay`).
 * Keeping the body identical means the card the user grabs looks exactly
 * like the one they drop.
 */
function BoardCardBody({ task, labels }: { task: Task; labels: Label[] }) {
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const isDone = task.lifecycle === "done";
  const hasMeta = taskLabels.length > 0 || dueLabel || assignee;

  return (
    <>
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-[3px] shrink-0" />
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[13.5px] leading-[1.4] tracking-[-0.005em] line-clamp-3",
              isDone
                ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]"
                : "text-[var(--fg)]",
            )}
          >
            {task.title}
          </span>
          <AiStatusInline status={task.aiStatus} className="mt-1" />
        </div>
      </div>
      {hasMeta ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[calc(12px+0.5rem)]">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {assignee ? (
            <Badge tone="neutral" variant="outline" className="max-w-[120px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : null}
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const cardBase = cn(
  "block w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
  "px-3 py-2.5 text-left select-none",
  "shadow-[0_1px_2px_oklch(0%_0_0/0.04)]",
  "transition-[background,border-color,opacity] duration-150 ease-[var(--ease-product)]",
  "hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
);

export function BoardCard({
  task,
  labels,
  onOpen,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  // A drag and a click both begin with pointerdown; the sensor's activation
  // distance decides which it becomes. Once a drag has started we swallow the
  // trailing click so dropping a card never also opens its detail sheet.
  const suppressClickRef = React.useRef(false);
  React.useEffect(() => {
    if (isDragging) suppressClickRef.current = true;
  }, [isDragging]);

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpen(task.id);
  };

  // KeyboardSensor owns Space (pick up / drop) and Escape (cancel); Enter is
  // ours, so a focused card opens with Enter just like a list row.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen(task.id);
      return;
    }
    listeners?.onKeyDown?.(e as unknown as KeyboardEvent);
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      style={{ cursor: "grab" }}
      className={cn(cardBase, "cursor-grab", isDragging && "opacity-40")}
    >
      <BoardCardBody task={task} labels={labels} />
    </div>
  );
}

/**
 * The lifted clone rendered inside `DragOverlay`. Purely presentational — no
 * drag wiring — with a scale + shadow "peak" defined by `.board-card-overlay`
 * (gated behind `prefers-reduced-motion`).
 */
export function BoardCardOverlay({ task, labels }: { task: Task; labels: Label[] }) {
  return (
    <div className={cn(cardBase, "board-card-overlay")} style={{ cursor: "grabbing" }}>
      <BoardCardBody task={task} labels={labels} />
    </div>
  );
}
