"use client";

import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * How far the pointer must travel before the gesture counts as a drag rather
 * than a click. Shared with the board's pointer sensor so the two can't
 * disagree about what the user just did — if they did, every drag would also
 * open the detail sheet on release.
 */
export const DRAG_ACTIVATION_DISTANCE = 5;

interface TaskCardProps {
  task: Task;
  onOpen: (id: string) => void;
  /** Keeps board selection in step with whatever the user tabbed onto. */
  onFocusTask?: (id: string) => void;
  selected?: boolean;
  tabIndex?: number;
  /** True for the card left behind while its overlay copy is being dragged. */
  dragging?: boolean;
  /** True for the copy inside the drag overlay: visual only, never an option. */
  overlay?: boolean;
  /** Pointer handlers from dnd-kit, applied to the card root. */
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
}

/**
 * A task as a board card.
 *
 * Same information as a list row, restacked for a narrow column: the title
 * leads, meta drops to a footer line instead of competing for the same
 * baseline. Card chrome is deliberately the row's chrome — priority glyph, due
 * badge, AI indicator — so scanning the board and scanning a list feel like
 * reading the same task twice, not two different records.
 */
export const TaskCard = React.forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  {
    task,
    onOpen,
    onFocusTask,
    selected = false,
    tabIndex = -1,
    dragging = false,
    overlay = false,
    dragListeners,
  },
  ref,
) {
  const updateTask = useStore((s) => s.updateTask);

  // The browser still fires a click after a drag, so the card measures the
  // pointer's travel itself rather than trusting the click alone.
  const pressOrigin = React.useRef<{ x: number; y: number } | null>(null);

  const travelledFar = (e: React.MouseEvent): boolean => {
    const origin = pressOrigin.current;
    pressOrigin.current = null;
    if (!origin) return false;
    return Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >= DRAG_ACTIVATION_DISTANCE;
  };

  const isDone = task.lifecycle === "done";
  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  return (
    <div
      {...dragListeners}
      ref={ref}
      {...(overlay
        ? { role: "presentation" as const, "aria-hidden": true }
        : { role: "option" as const, "aria-selected": selected, tabIndex })}
      aria-label={overlay ? undefined : task.title}
      data-task-id={task.id}
      onPointerDown={(e) => {
        pressOrigin.current = { x: e.clientX, y: e.clientY };
        dragListeners?.onPointerDown?.(e);
      }}
      onFocus={() => onFocusTask?.(task.id)}
      onClick={(e) => {
        if (travelledFar(e)) return;
        onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        // touch-manipulation, not touch-none: the touch sensor activates on a
        // long press, so a plain swipe must still scroll the columns.
        "group w-full cursor-default touch-manipulation select-none rounded-[var(--radius-md)] border p-2.5",
        "border-[var(--border)] bg-[var(--surface)]",
        "transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
        "focus-visible:outline-none focus-visible:border-[var(--accent)]",
        selected && "border-[var(--accent)] bg-[var(--surface-hover)]",
        // The original stays in place as a quiet gap while the overlay flies.
        dragging && "opacity-40",
        overlay && "shadow-lg border-[var(--border-strong)] rotate-[1.5deg] cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            updateTask(task.id, { lifecycle: isDone ? "active" : "done" });
          }}
          // Without this the press would arm a drag on the card behind it.
          // MouseSensor listens on mousedown and TouchSensor on touchstart,
          // so those have to be stopped as well as pointerdown.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "relative mt-px size-4 shrink-0 rounded-full border flex items-center justify-center",
            "after:absolute after:-inset-2 after:content-['']",
            "transition-all duration-150 ease-[var(--ease-product)]",
            !isDone &&
              "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>

        <span
          className={cn(
            "min-w-0 flex-1 text-[13.5px] leading-[1.35] tracking-[-0.005em] line-clamp-3",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
      </div>

      {task.nextAction && !isDone ? (
        <div className="mt-1.5 pl-6 truncate text-[11.5px] text-[var(--fg-muted)]">
          {task.nextAction}
        </div>
      ) : null}

      <div className="mt-2 pl-6 flex items-center gap-2 min-h-[18px]">
        <PriorityGlyph bucket={task.priorityBucket} size={11} />
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        <AiStatusInline status={task.aiStatus} className="ml-auto" />
      </div>
    </div>
  );
});

/**
 * Draggable wrapper.
 *
 * dnd-kit's `attributes` are deliberately not spread: they advertise the
 * library's own space-bar lift model, which this board does not use. Moving a
 * card by keyboard is a plain shortcut on the board instead, so borrowing that
 * description would tell screen reader users to press a key that does nothing.
 */
export const DraggableTaskCard = React.memo(function DraggableTaskCard({
  task,
  onOpen,
  onFocusTask,
  selected,
  tabIndex,
  registerRef,
}: {
  task: Task;
  onOpen: (id: string) => void;
  onFocusTask: (id: string) => void;
  selected: boolean;
  tabIndex: number;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });

  // dnd-kit owns the node ref; the board needs the same node to move focus.
  const ref = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      registerRef(task.id, el);
    },
    [setNodeRef, registerRef, task.id],
  );

  return (
    <TaskCard
      ref={ref}
      task={task}
      onOpen={onOpen}
      onFocusTask={onFocusTask}
      selected={selected}
      tabIndex={tabIndex}
      dragging={isDragging}
      dragListeners={listeners as React.HTMLAttributes<HTMLDivElement>}
    />
  );
});
