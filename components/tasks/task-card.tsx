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

export const TaskCard = React.memo(function TaskCard({
  task,
  labels,
  selected = false,
  overlay = false,
  onOpen,
  onSelect,
}: {
  task: Task;
  labels: Label[];
  selected?: boolean;
  overlay?: boolean;
  onOpen?: (id: string) => void;
  onSelect?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id, lifecycle: task.lifecycle },
    disabled: overlay,
  });
  const pointerOrigin = React.useRef<{ x: number; y: number } | null>(null);
  const moved = React.useRef(false);
  const labelMap = React.useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const taskLabels = task.labelIds.flatMap((id) => {
    const label = labelMap.get(id);
    return label ? [label] : [];
  });
  const dueLabel = formatRelativeDay(task.due);
  const dueTone = isOverdue(task.due) ? "rose" : isToday(task.due) ? "ember" : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      aria-label={task.title}
      tabIndex={selected ? 0 : -1}
      onPointerDown={(event) => {
        listeners?.onPointerDown?.(event);
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
        moved.current = false;
        onSelect?.(task.id);
      }}
      onPointerMove={(event) => {
        const origin = pointerOrigin.current;
        if (!origin) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= 5)
          moved.current = true;
      }}
      onClick={(event) => {
        if (moved.current || isDragging || overlay) {
          event.preventDefault();
          return;
        }
        onOpen?.(task.id);
      }}
      className={cn(
        "surface-card touch-pan-x select-none p-3 shadow-sm",
        "transition-[border-color,background-color,opacity,box-shadow] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]",
        selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]/20",
        isDragging && "opacity-35",
        overlay && "w-[260px] rotate-[1deg] shadow-lg",
      )}
      data-task-id={task.id}
    >
      <div className="flex items-start gap-2">
        <PriorityGlyph bucket={task.priorityBucket} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-1.5">
            <span className="line-clamp-2 flex-1 text-[13.5px] leading-[1.4] text-[var(--fg)]">
              {task.title}
            </span>
            <AiStatusInline status={task.aiStatus} />
          </div>
          {task.nextAction ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.4] text-[var(--fg-muted)]">
              {task.nextAction}
            </p>
          ) : null}
        </div>
      </div>

      {taskLabels.length > 0 || assignee || dueLabel ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-num text-[10.5px] text-[var(--fg-subtle)]">
              +{taskLabels.length - 2}
            </span>
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
    </div>
  );
});
