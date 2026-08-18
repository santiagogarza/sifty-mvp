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

const DRAG_CLICK_SLOP_PX = 5;

export const TaskCard = React.memo(function TaskCard({
  task,
  labels,
  onOpen,
  onComplete,
  active = false,
  tabIndex = -1,
  overlay = false,
}: {
  task: Task;
  labels: Label[];
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  active?: boolean;
  tabIndex?: number;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  });
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;

  const origin = React.useRef<{ x: number; y: number } | null>(null);
  const suppressClick = React.useRef(false);

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
  const isDone = task.lifecycle === "done";

  const onPointerDownCapture = (e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY };
    suppressClick.current = false;
  };

  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    if (Math.hypot(dx, dy) > DRAG_CLICK_SLOP_PX) suppressClick.current = true;
  };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      data-testid={`task-card-${task.id}`}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : dragAttributes)}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onClick={() => {
        if (suppressClick.current || isDragging) return;
        onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      className={cn(
        "group relative cursor-default rounded-[var(--radius-md)] border px-2.5 py-2",
        "bg-[var(--surface)] border-[var(--border)]",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        "hover:bg-[var(--surface-muted)]",
        active && "border-[var(--border-strong)] bg-[var(--surface-muted)]",
        isDragging && "opacity-40",
        overlay && "shadow-md rotate-1 cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onComplete(task.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "relative mt-0.5 size-5 shrink-0 rounded-full border flex items-center justify-center",
            "after:absolute after:-inset-1.5 after:content-['']",
            "transition-all duration-150 ease-[var(--ease-product)]",
            !isDone &&
              "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={12} className="text-white" strokeWidth={3} /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <PriorityGlyph bucket={task.priorityBucket} />
            <span
              className={cn(
                "min-w-0 truncate text-[13.5px] leading-[1.35] tracking-[-0.005em]",
                isDone
                  ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]"
                  : "text-[var(--fg)]",
              )}
            >
              {task.title}
            </span>
            <AiStatusInline status={task.aiStatus} />
          </div>
          {task.nextAction && !isDone ? (
            <div className="truncate text-[12px] text-[var(--fg-muted)] mt-0.5 pl-[22px]">
              {task.nextAction}
            </div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[22px]">
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
        </div>
      </div>
    </div>
  );
});
