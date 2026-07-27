"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "../ai-status";
import { PriorityGlyph } from "../priority-glyph";

/**
 * Board card. Title wraps to two lines; next action truncates to one.
 * Complete shares the 16px glyph slot (glyph at rest, circle on hover/focus)
 * so revealing it never reflows the card. The whole card is the drag handle.
 */
export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Label[];
    selected?: boolean;
    tabIndex?: number;
    draggable?: boolean;
    settling?: boolean;
    onOpen: (id: string) => void;
    onSelect?: (id: string) => void;
    onLongPress?: (id: string) => void;
    /** When true, the next click is swallowed (post-drag). */
    suppressOpenRef?: React.MutableRefObject<boolean>;
    uncompleteTo?: Lifecycle;
  }
>(function BoardCard(
  {
    task,
    labels,
    selected = false,
    tabIndex = -1,
    draggable = true,
    settling = false,
    onOpen,
    onSelect,
    onLongPress,
    suppressOpenRef,
    uncompleteTo = "active",
  },
  ref,
) {
  const updateTask = useStore((s) => s.updateTask);
  const isDone = task.lifecycle === "done";
  const dragDisabled = !draggable;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { type: "task", taskId: task.id, from: task.lifecycle },
    disabled: dragDisabled,
  });

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [setNodeRef, ref],
  );

  const labelMap = React.useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const firstLabel = task.labelIds.map((id) => labelMap.get(id)).find(Boolean) as Label | undefined;
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const badgeLabel = assignee ?? firstLabel?.name ?? null;
  const badgeTone = assignee ? ("neutral" as const) : (firstLabel?.tone ?? "mist");

  const due = task.due;
  const overdue = isOverdue(due);
  const dueLabel = formatRelativeDay(due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(due)
      ? "ember"
      : "neutral";

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, {
      lifecycle: isDone ? uncompleteTo : "done",
    });
  };

  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = React.useRef<{ x: number; y: number } | null>(null);
  const didLongPress = React.useRef(false);
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  };

  const style: React.CSSProperties | undefined = isDragging
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: 0,
        zIndex: 50,
      }
    : undefined;

  const dragPointerDown = listeners?.onPointerDown as ((e: React.PointerEvent) => void) | undefined;

  return (
    <div
      ref={setRefs}
      data-task-id={task.id}
      style={style}
      {...(dragDisabled ? {} : listeners)}
      {...(dragDisabled ? {} : attributes)}
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={(e) => {
        // Drag and long-press both synthesize a click on release — swallow those
        // so they don't open the detail sheet over the undo / Move-to UI.
        if (didLongPress.current || isDragging || suppressOpenRef?.current) {
          didLongPress.current = false;
          if (suppressOpenRef) suppressOpenRef.current = false;
          e.preventDefault();
          e.stopPropagation();
          onSelect?.(task.id);
          return;
        }
        onSelect?.(task.id);
        onOpen(task.id);
      }}
      onFocus={() => onSelect?.(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task.id);
        }
      }}
      onPointerDown={(e) => {
        dragPointerDown?.(e);
        if (!onLongPress || !dragDisabled) return;
        if (e.pointerType !== "touch") return;
        didLongPress.current = false;
        clearLongPress();
        longPressOrigin.current = { x: e.clientX, y: e.clientY };
        longPressTimer.current = setTimeout(() => {
          didLongPress.current = true;
          onLongPress(task.id);
          clearLongPress();
        }, 450);
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerMove={(e) => {
        // Only cancel long-press on a real finger drag, not micro-jitter.
        const origin = longPressOrigin.current;
        if (!origin || !longPressTimer.current) return;
        const dx = e.clientX - origin.x;
        const dy = e.clientY - origin.y;
        if (dx * dx + dy * dy > 100) clearLongPress();
      }}
      className={cn(
        "group relative flex w-full flex-col gap-1",
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
        "px-3 py-2 text-left cursor-grab active:cursor-grabbing",
        "transition-[box-shadow,border-color,background-color,transform] duration-150 ease-[var(--ease-product)]",
        "hover:border-[var(--border-strong)] hover:shadow-[0_1px_0_var(--border)]",
        selected && "border-[var(--accent)]/50 ring-1 ring-[var(--accent)]/30",
        settling && "animate-fill-in",
        isDone && "opacity-80",
        dragDisabled && "cursor-pointer active:cursor-pointer",
      )}
    >
      <p
        className={cn(
          "line-clamp-2 text-[13px] leading-[18px]",
          isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
        )}
      >
        {task.title}
      </p>
      {task.nextAction && !isDone ? (
        <p className="truncate text-[12px] leading-4 text-[var(--fg-muted)]">{task.nextAction}</p>
      ) : null}
      <AiStatusInline status={task.aiStatus} className="mt-0.5" />
      <div className="flex items-center gap-1 overflow-hidden w-full mt-0.5">
        <div className="relative size-4 shrink-0 flex items-center justify-center">
          <PriorityGlyph
            bucket={task.priorityBucket}
            className={cn(
              "transition-opacity duration-150",
              "group-hover:opacity-0 group-focus-within:opacity-0",
              selected && "opacity-0",
            )}
          />
          <button
            type="button"
            onClick={onComplete}
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            className={cn(
              "absolute inset-0 rounded-full border flex items-center justify-center",
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              selected && "opacity-100",
              "transition-opacity duration-150 ease-[var(--ease-product)]",
              !isDone &&
                "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
              isDone && "opacity-100 bg-[var(--done)] border-[var(--done)]",
            )}
          >
            {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
          </button>
        </div>
        {dueLabel ? (
          <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
            {dueLabel}
          </Badge>
        ) : null}
        {badgeLabel ? (
          <Badge tone={badgeTone} variant={assignee ? "outline" : "soft"} className="max-w-[90px]">
            <span className="truncate">{badgeLabel}</span>
          </Badge>
        ) : null}
      </div>
    </div>
  );
});

/** Floating preview while dragging — rendered in DragOverlay. */
export function BoardCardOverlay({ task, labels }: { task: Task; labels: Label[] }) {
  return (
    <div className="pointer-events-none rotate-[1.5deg] shadow-[0_12px_40px_-12px_oklch(0%_0_0/0.45)] scale-[1.02]">
      <BoardCard task={task} labels={labels} onOpen={() => {}} draggable={false} />
    </div>
  );
}

/** Placeholder left in the source column while a card is mid-drag. */
export function BoardCardGhost({ height = 72 }: { height?: number }) {
  return (
    <div
      aria-hidden
      className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)]/60"
      style={{ height }}
    />
  );
}
