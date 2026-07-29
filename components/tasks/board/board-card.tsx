"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "../ai-status";
import { PriorityGlyph } from "../priority-glyph";

/**
 * Board card.
 *
 * The whole card is the drag handle — no grip glyph (16px of grip is a
 * sliver of the card, Fitts's Law says use the whole surface). Complete
 * shares one 16px slot with the priority glyph: glyph at rest, circle on
 * hover and keyboard focus, so revealing it never reflows the card.
 *
 * Content is exactly: title (two lines max), the AI next action (one line),
 * priority glyph, a due badge, and one badge — the assignee when the task
 * is delegated to a person, the first label otherwise. The AI status chip
 * appears while triage is still running. Nothing else.
 */

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Label[];
    selected?: boolean;
    /** Source card while it is being dragged: dashed tray, faded content. */
    ghost?: boolean;
    /** Floating drag preview rendered in the DragOverlay. */
    overlay?: boolean;
    tabIndex?: number;
    onOpen?: (id: string) => void;
    onComplete?: (task: Task) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    onFocus?: () => void;
    /** Touch long-press — opens the mobile "Move to" sheet. */
    onLongPress?: (task: Task) => void;
    /** dnd-kit activator listeners; spread onto the card root. */
    dragListeners?: React.DOMAttributes<HTMLDivElement>;
  }
>(function BoardCard(
  {
    task,
    labels,
    selected = false,
    ghost = false,
    overlay = false,
    tabIndex = -1,
    onOpen,
    onComplete,
    onKeyDown,
    onFocus,
    onLongPress,
    dragListeners,
  },
  ref,
) {
  const isDone = task.lifecycle === "done";

  const dueLabel = formatRelativeDay(task.due);
  const overdue = isOverdue(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";

  // One badge: the assignee when delegated to a person, else first label.
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const firstLabel = !assignee ? (labels.find((l) => l.id === task.labelIds[0]) ?? null) : null;

  const longPress = React.useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  // Long-press consumes the gesture; the synthetic click that follows
  // touchend must not also open the detail sheet.
  const suppressClickRef = React.useRef(false);
  const cancelLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };
  React.useEffect(() => {
    return () => {
      if (longPress.current) clearTimeout(longPress.current.timer);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={tabIndex}
      data-task-id={overlay ? undefined : task.id}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onOpen?.(task.id);
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onTouchStart={(e) => {
        if (!onLongPress) return;
        const t = e.touches[0];
        if (!t) return;
        cancelLongPress();
        longPress.current = {
          x: t.clientX,
          y: t.clientY,
          timer: setTimeout(() => {
            longPress.current = null;
            suppressClickRef.current = true;
            onLongPress(task);
          }, LONG_PRESS_MS),
        };
      }}
      onTouchMove={(e) => {
        const start = longPress.current;
        if (!start) return;
        const t = e.touches[0];
        if (!t) return;
        if (
          Math.abs(t.clientX - start.x) > LONG_PRESS_SLOP_PX ||
          Math.abs(t.clientY - start.y) > LONG_PRESS_SLOP_PX
        ) {
          cancelLongPress();
        }
      }}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      {...dragListeners}
      className={cn(
        "group relative flex w-full select-none flex-col gap-1 [-webkit-touch-callout:none]",
        "rounded-[var(--radius-md)] border bg-[var(--surface)] px-3 py-2",
        "transition-[border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        "md:cursor-grab md:active:cursor-grabbing focus:outline-none",
        ghost && "border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)]",
        overlay && "shadow-[0_8px_24px_-6px_oklch(0%_0_0/0.5)]",
        selected
          ? "border-[var(--accent)] ring-1 ring-inset ring-[var(--accent)]"
          : overlay || ghost
            ? "border-[var(--border-strong)]"
            : "border-[var(--border)] hover:border-[var(--border-strong)] hover:shadow-[0_1px_2px_oklch(0%_0_0/0.18)]",
      )}
    >
      <div className={cn("flex min-w-0 flex-col gap-1", ghost && "opacity-30")}>
        <span
          className={cn(
            "line-clamp-2 text-[13px] leading-[18px]",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
        {task.nextAction && !isDone ? (
          <span className="truncate text-[12px] leading-[16px] text-[var(--fg-muted)]">
            {task.nextAction}
          </span>
        ) : null}
        <div className="flex min-h-4 items-center gap-1.5 overflow-hidden">
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            {!isDone ? (
              <PriorityGlyph
                bucket={task.priorityBucket}
                className="transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
              />
            ) : null}
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onComplete?.(task);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              className={cn(
                // The visible circle is 16px; the ::after pseudo pads the
                // hit target to ~28px without changing the layout.
                "absolute inset-0 flex items-center justify-center rounded-full border",
                "after:absolute after:-inset-1.5 after:content-['']",
                "transition-all duration-150 ease-[var(--ease-product)]",
                isDone
                  ? "bg-[var(--done)] border-[var(--done)]"
                  : cn(
                      "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                      "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:border-[var(--accent)]",
                    ),
              )}
            >
              {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
            </button>
          </span>
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
          {assignee ? (
            <Badge tone="neutral" variant="outline" className="max-w-[110px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : null}
          {firstLabel ? (
            <Badge tone={firstLabel.tone} className="max-w-[110px]">
              <span className="truncate">{firstLabel.name}</span>
            </Badge>
          ) : null}
          <AiStatusInline status={task.aiStatus} className="shrink-0" />
        </div>
      </div>
    </div>
  );
});
