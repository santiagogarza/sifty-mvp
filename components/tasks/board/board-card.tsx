"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { PriorityGlyph } from "../priority-glyph";

export function BoardCard({
  task,
  labels,
  active,
  tabIndex,
  mobile,
  onOpen,
  onFocus,
  onLongPress,
  registerRef,
}: {
  task: Task;
  labels: Label[];
  active: boolean;
  tabIndex: number;
  mobile: boolean;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  onLongPress: (task: Task) => void;
  registerRef: (element: HTMLDivElement | null) => void;
}) {
  const updateTask = useStore((state) => state.updateTask);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: mobile,
  });
  const taskLabels = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter(Boolean) as Label[];
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";
  const isDone = task.lifecycle === "done";

  const clearLongPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div
      {...attributes}
      {...listeners}
      ref={(element) => {
        setNodeRef(element);
        registerRef(element);
      }}
      role="option"
      aria-selected={active}
      aria-label={`${task.title}, ${task.lifecycle}`}
      tabIndex={tabIndex}
      onFocus={() => onFocus(task.id)}
      onClick={() => {
        if (!isDragging) onOpen(task.id);
      }}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        if (mobile) timer.current = setTimeout(() => onLongPress(task), 550);
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      className={cn(
        "group relative flex min-h-[78px] w-full touch-pan-y flex-col gap-1 rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 py-2 text-left",
        "transition-[border-color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:shadow-[0_1px_2px_oklch(0%_0_0/0.18)] md:cursor-grab",
        active && "border-[var(--accent)] shadow-[0_1px_2px_oklch(0%_0_0/0.18)]",
        isDragging && "z-20 opacity-50 shadow-[0_8px_24px_-6px_oklch(0%_0_0/0.5)]",
      )}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
    >
      <div
        className={cn(
          "line-clamp-2 text-[13px] leading-[18px] text-[var(--fg)]",
          isDone && "text-[var(--fg-subtle)] line-through",
        )}
      >
        {task.title}
      </div>
      {task.nextAction && !isDone ? (
        <div className="truncate text-[12px] leading-4 text-[var(--fg-muted)]">
          {task.nextAction}
        </div>
      ) : null}
      <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden">
        <div className="relative flex size-4 shrink-0 items-center justify-center">
          <PriorityGlyph
            bucket={task.priorityBucket}
            className="transition-opacity group-hover:opacity-0 group-focus:opacity-0"
          />
          <button
            type="button"
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              updateTask(task.id, { lifecycle: isDone ? "active" : "done" });
            }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full border opacity-0 group-hover:opacity-100 group-focus:opacity-100",
              isDone
                ? "border-[var(--done)] bg-[var(--done)] text-white opacity-100"
                : "border-[var(--fg-muted)]/50 bg-[var(--surface)]",
            )}
          >
            {isDone ? <Check size={10} strokeWidth={3} /> : null}
          </button>
        </div>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {taskLabels[0] ? <Badge tone={taskLabels[0].tone}>{taskLabels[0].name}</Badge> : null}
      </div>
    </div>
  );
}
