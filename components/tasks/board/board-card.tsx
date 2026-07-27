"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check } from "lucide-react";
import * as React from "react";
import { PriorityGlyph } from "../priority-glyph";

export const BOARD_CARD_DRAG_TYPE = "task";

export function BoardCard({
  task,
  labels,
  active,
  tabIndex,
  onOpen,
  onLongPress,
  onFocusTask,
  register,
}: {
  task: Task;
  labels: Label[];
  active: boolean;
  tabIndex: number;
  onOpen: (id: string) => void;
  onLongPress: (task: Task) => void;
  onFocusTask: (id: string) => void;
  register?: (node: HTMLDivElement | null) => void;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const draggable = useDraggable({
    id: task.id,
    data: { type: BOARD_CARD_DRAG_TYPE, lifecycle: task.lifecycle },
  });
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";
  const primaryLabel = taskLabels[0];
  const isDone = task.lifecycle === "done";

  const setNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      draggable.setNodeRef(node);
      register?.(node);
    },
    [draggable.setNodeRef, register],
  );

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);

  React.useEffect(() => clearLongPress, [clearLongPress]);

  return (
    <div
      ref={setNode}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      data-task-id={task.id}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={() => onOpen(task.id)}
      onFocus={() => onFocusTask(task.id)}
      onPointerDown={(event) => {
        longPressTimer.current = setTimeout(() => onLongPress(task), 520);
        draggable.listeners?.onPointerDown?.(event);
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative flex min-h-[92px] w-full cursor-grab flex-col gap-1 rounded-[var(--radius-md)]",
        "border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left",
        "shadow-[0_1px_2px_oklch(0%_0_0/0.08)]",
        "transition-[border,box-shadow,opacity,transform,background] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:shadow-[0_1px_3px_oklch(0%_0_0/0.18)]",
        "focus:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
        "motion-reduce:transition-none",
        active && "border-[var(--accent)]",
        draggable.isDragging &&
          "z-20 opacity-80 shadow-[0_16px_32px_-12px_oklch(0%_0_0/0.55)] cursor-grabbing",
        isDone && "min-h-[72px]",
      )}
      style={{
        transform: CSS.Translate.toString(draggable.transform),
      }}
    >
      <div
        className={cn(
          "line-clamp-2 text-[13px] leading-[18px] text-[var(--fg)]",
          isDone && "text-[var(--fg-subtle)] line-through decoration-[1.5px]",
        )}
      >
        {task.title}
      </div>
      {task.nextAction && !isDone ? (
        <div className="truncate text-[12px] leading-4 text-[var(--fg-muted)]">
          {task.nextAction}
        </div>
      ) : null}
      <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden pt-1">
        <button
          type="button"
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          onClick={(event) => {
            event.stopPropagation();
            updateTask(task.id, { lifecycle: isDone ? "active" : "done" });
          }}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            "transition-colors duration-150 ease-[var(--ease-product)]",
            isDone
              ? "border-[var(--done)] bg-[var(--done)] text-white"
              : "border-[var(--border-strong)] bg-[var(--surface-muted)] text-transparent group-hover:text-[var(--fg-muted)]",
          )}
        >
          {isDone ? <Check size={10} strokeWidth={3} /> : <Check size={10} strokeWidth={3} />}
        </button>
        {!isDone ? <PriorityGlyph bucket={task.priorityBucket} className="shrink-0" /> : null}
        {dueLabel ? (
          <Badge
            tone={dueTone}
            variant={dueTone === "neutral" ? "outline" : "soft"}
            className="shrink-0"
          >
            {dueLabel}
          </Badge>
        ) : null}
        {primaryLabel ? (
          <Badge tone={primaryLabel.tone} className="min-w-0 shrink">
            <span className="truncate">{primaryLabel.name}</span>
          </Badge>
        ) : null}
        {taskLabels.length > 1 ? (
          <span className="shrink-0 text-[11px] text-[var(--fg-subtle)]">
            +{taskLabels.length - 1}
          </span>
        ) : null}
      </div>
    </div>
  );
}
