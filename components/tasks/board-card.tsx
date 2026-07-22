"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

export function BoardCard({
  task,
  labels,
  active = false,
  overlay = false,
  onOpen,
}: {
  task: Task;
  labels: Label[];
  active?: boolean;
  overlay?: boolean;
  onOpen?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: overlay,
  });
  const {
    onKeyDown: onDragKeyDown,
    onPointerDown: onDragPointerDown,
    onMouseDown: onDragMouseDown,
    ...dragListeners
  } = (listeners ?? {}) as Record<string, ((event: React.SyntheticEvent) => void) | undefined>;
  const pressStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  const style =
    overlay || active || isDragging
      ? undefined
      : {
          transform: CSS.Translate.toString(transform),
        };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : dragListeners)}
      onPointerDown={(e) => {
        pressStartRef.current = { x: e.clientX, y: e.clientY };
        if (!overlay) onDragPointerDown?.(e);
      }}
      onMouseDown={(e) => {
        pressStartRef.current = { x: e.clientX, y: e.clientY };
        if (!overlay) onDragMouseDown?.(e);
      }}
      onClick={(e) => {
        const pressStart = pressStartRef.current;
        pressStartRef.current = null;
        if (pressStart) {
          const distance = Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y);
          if (distance >= 5) {
            e.preventDefault();
            return;
          }
        }
        onOpen?.(task.id);
      }}
      onKeyDown={(e) => {
        if (!overlay) onDragKeyDown?.(e);
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen?.(task.id);
        }
      }}
      className={cn(
        "group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-left",
        "shadow-[0_1px_0_oklch(100%_0_0/0.04)_inset,0_1px_2px_oklch(0%_0_0/0.08)]",
        "touch-none select-none transition-[opacity,transform,box-shadow,border-color,background-color]",
        "duration-200 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
        !overlay && "cursor-grab active:cursor-grabbing",
        (active || isDragging) && !overlay && "opacity-40",
        overlay &&
          "cursor-grabbing border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[0_18px_46px_-18px_oklch(0%_0_0/0.55),0_2px_8px_oklch(0%_0_0/0.16)] motion-safe:scale-[1.03]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <PriorityGlyph bucket={task.priorityBucket} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <h2
              className={cn(
                "min-w-0 flex-1 text-[13.5px] font-medium leading-[1.35] tracking-[-0.005em] text-[var(--fg)]",
                task.lifecycle === "done" &&
                  "text-[var(--fg-subtle)] line-through decoration-[1.5px]",
              )}
            >
              {task.title}
            </h2>
            <AiStatusInline status={task.aiStatus} className="mt-0.5 shrink-0" />
          </div>
          {task.nextAction && task.lifecycle !== "done" ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-[1.45] text-[var(--fg-muted)]">
              {task.nextAction}
            </p>
          ) : null}
        </div>
      </div>

      {labels.length > 0 || dueLabel ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {labels.slice(0, 3).map((label) => (
            <Badge key={label.id} tone={label.tone} className="max-w-full">
              <span className="truncate">{label.name}</span>
            </Badge>
          ))}
          {labels.length > 3 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{labels.length - 3}</span>
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
