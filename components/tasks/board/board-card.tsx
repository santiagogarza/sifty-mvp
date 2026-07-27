"use client";

import { Badge } from "@/components/ui/badge";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check } from "lucide-react";
import * as React from "react";
import { PriorityGlyph } from "../priority-glyph";

export function BoardCard({
  task,
  labels,
  active,
  tabIndex,
  onOpen,
  onLongPress,
  onBoardKeyDown,
  suppressClickRef,
  dragDisabled,
  cardRef,
}: {
  task: Task;
  labels: Label[];
  active?: boolean;
  tabIndex?: number;
  onOpen: (id: string) => void;
  onLongPress?: (task: Task) => void;
  onBoardKeyDown?: (e: React.KeyboardEvent) => void;
  suppressClickRef?: React.RefObject<boolean>;
  dragDisabled?: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const updateTask = useStore((s) => s.updateTask);
  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: dragDisabled,
  });

  const dragAttrs = React.useMemo(() => {
    const { role: _role, ...rest } = attributes;
    return rest;
  }, [attributes]);

  const dragPointerDown = listeners?.onPointerDown;
  const dragListeners = React.useMemo(() => {
    if (!listeners) return {};
    const { onPointerDown: _pd, ...rest } = listeners;
    return rest;
  }, [listeners]);

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof cardRef === "function") cardRef(node);
      else if (cardRef) (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [setNodeRef, cardRef],
  );

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";
  const isDone = task.lifecycle === "done";

  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = React.useRef(false);

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, {
      lifecycle: isDone ? "active" : "done",
    });
  };

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined;

  return (
    <div
      ref={setRef}
      role="option"
      aria-selected={active}
      tabIndex={tabIndex}
      style={style}
      {...(dragDisabled ? {} : { ...dragAttrs, ...dragListeners })}
      onClick={() => {
        if (longPressFired.current) {
          longPressFired.current = false;
          return;
        }
        if (isDragging || suppressClickRef?.current) return;
        onOpen(task.id);
      }}
      onKeyDown={(e) => {
        if (active && onBoardKeyDown) {
          const navKeys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "j", "k", "Enter"];
          if (navKeys.includes(e.key)) {
            onBoardKeyDown(e);
            return;
          }
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      onPointerDown={(e) => {
        dragPointerDown?.(e);
        if (!onLongPress || dragDisabled) return;
        longPressTimer.current = setTimeout(() => {
          longPressFired.current = true;
          onLongPress(task);
        }, 500);
        const clear = () => {
          if (longPressTimer.current) clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        };
        e.currentTarget.addEventListener("pointerup", clear, { once: true });
        e.currentTarget.addEventListener("pointercancel", clear, { once: true });
      }}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)]",
        "bg-[var(--bg-elevated)] px-3 py-2.5 touch-none",
        !dragDisabled && "cursor-grab active:cursor-grabbing",
        "transition-[box-shadow,background-color,border-color] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:shadow-sm",
        active && "ring-2 ring-[var(--accent)]/40 border-[var(--accent)]/30",
        isDragging && "opacity-60 shadow-lg",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onComplete}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "relative mt-0.5 size-4 shrink-0 rounded-full border flex items-center justify-center",
            "after:absolute after:-inset-1.5 after:content-['']",
            "transition-all duration-150 ease-[var(--ease-product)]",
            !isDone &&
              "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <PriorityGlyph bucket={task.priorityBucket} />
            <span
              className={cn(
                "text-[13px] leading-[1.35] tracking-[-0.005em] line-clamp-2",
                isDone
                  ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]"
                  : "text-[var(--fg)]",
              )}
            >
              {task.title}
            </span>
          </div>
          {task.nextAction && !isDone ? (
            <p className="mt-1 truncate text-[11px] text-[var(--fg-muted)]">{task.nextAction}</p>
          ) : null}
        </div>
      </div>
      {(dueLabel || taskLabels.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 pl-6">
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone} className="text-[10px] px-1.5 py-0">
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[10px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          {dueLabel ? (
            <Badge
              tone={dueTone}
              variant={dueTone === "neutral" ? "outline" : "soft"}
              className="text-[10px] px-1.5 py-0"
            >
              {dueLabel}
            </Badge>
          ) : null}
        </div>
      )}
    </div>
  );
}

export type { Lifecycle };
