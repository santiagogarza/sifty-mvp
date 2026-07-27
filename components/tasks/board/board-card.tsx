"use client";

import { AiStatusInline } from "@/components/tasks/ai-status";
import { PriorityGlyph } from "@/components/tasks/priority-glyph";
import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";

/**
 * A card says four things: title, Sifty's next action, priority, and a
 * date. Everything else is one click deeper in the detail sheet that
 * already ships — a 194px column has no room to be a second sheet.
 *
 * The whole card is the drag handle, so there is no grip to aim at. The
 * complete circle shares one fixed slot with the priority glyph: glyph at
 * rest, circle on hover and on keyboard focus, so revealing it never
 * reflows the card.
 */

/** Long-press that opens the "Move to" sheet on touch, in ms. */
const LONG_PRESS_MS = 450;

export const BoardCard = React.forwardRef<
  HTMLDivElement,
  {
    task: Task;
    labels: Map<string, Label>;
    selected?: boolean;
    tabIndex?: number;
    draggable?: boolean;
    onOpen: (id: string) => void;
    onComplete: (task: Task) => void;
    onLongPress?: (task: Task) => void;
    onSelect?: (task: Task) => void;
  }
>(function BoardCard(
  {
    task,
    labels,
    selected = false,
    tabIndex = -1,
    draggable = true,
    onOpen,
    onComplete,
    onLongPress,
    onSelect,
  },
  ref,
) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable,
    data: { lifecycle: task.lifecycle },
  });

  const longPress = useLongPress(onLongPress ? () => onLongPress(task) : undefined);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      // dnd-kit's attributes come first so the roving tabindex and the
      // listbox role below win: a card is an option, not a button.
      {...attributes}
      {...listeners}
      {...longPress}
      role="option"
      aria-selected={selected}
      aria-label={task.title}
      tabIndex={tabIndex}
      data-task-id={task.id}
      onFocus={() => onSelect?.(task)}
      onClick={() => onOpen(task.id)}
      className={cn(
        CARD_SHELL,
        "hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/40",
        draggable && "cursor-grab active:cursor-grabbing",
        selected && "border-[var(--accent)] ring-1 ring-[var(--accent)]",
        // A ghost holds the slot so the source column keeps its shape
        // while the pointer is elsewhere.
        isDragging && "opacity-35 border-dashed",
      )}
    >
      <CardBody task={task} labels={labels} onComplete={onComplete} />
    </div>
  );
});

/** The lifted copy that follows the pointer. */
export function BoardCardOverlay({ task, labels }: { task: Task; labels: Map<string, Label> }) {
  return (
    <div
      className={cn(
        CARD_SHELL,
        "cursor-grabbing border-[var(--border-strong)]",
        "shadow-[0_16px_32px_-12px_oklch(0%_0_0/0.55)]",
      )}
    >
      <CardBody task={task} labels={labels} />
    </div>
  );
}

const CARD_SHELL = cn(
  "group/card flex w-full flex-col gap-2 p-3 text-left",
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]",
  "transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
);

function CardBody({
  task,
  labels,
  onComplete,
}: {
  task: Task;
  labels: Map<string, Label>;
  onComplete?: (task: Task) => void;
}) {
  const isDone = task.lifecycle === "done";
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = isOverdue(task.due)
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const chip = task.labelIds.map((id) => labels.get(id)).find(Boolean);
  const triaging = task.aiStatus === "pending" || task.aiStatus === "running";

  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "line-clamp-2 text-[13px] leading-[18px] [overflow-wrap:anywhere]",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
        {task.nextAction && !isDone ? (
          <span className="truncate text-[12px] leading-4 text-[var(--fg-muted)]">
            {task.nextAction}
          </span>
        ) : null}
      </div>

      {triaging ? (
        <AiStatusInline status={task.aiStatus} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CompleteSlot task={task} isDone={isDone} onComplete={onComplete} />
          {dueLabel && !isDone ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
          {assignee ? (
            <Badge tone="neutral" variant="outline" className="max-w-[110px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : chip ? (
            <Badge tone={chip.tone} className="max-w-[110px]">
              <span className="truncate">{chip.name}</span>
            </Badge>
          ) : null}
          {task.aiStatus === "failed" ? <AiStatusInline status={task.aiStatus} /> : null}
        </div>
      )}
    </>
  );
}

/**
 * One 16px slot, two occupants. Sifty is keyboard-first, so a hover-only
 * complete affordance would be a hole: keyboard focus on the card reveals
 * the circle too.
 */
function CompleteSlot({
  task,
  isDone,
  onComplete,
}: {
  task: Task;
  isDone: boolean;
  onComplete?: (task: Task) => void;
}) {
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      {!isDone ? (
        <PriorityGlyph
          bucket={task.priorityBucket}
          className={cn(
            "transition-opacity duration-150 ease-[var(--ease-product)]",
            onComplete && "group-hover/card:opacity-0 group-focus-within/card:opacity-0",
          )}
        />
      ) : null}
      <button
        type="button"
        disabled={!onComplete}
        onClick={(e) => {
          e.stopPropagation();
          onComplete?.(task);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={isDone ? "Mark as not done" : "Mark as done"}
        className={cn(
          // The ::after pseudo pads the hit target to ~32px (Fitts)
          // without changing the 16px slot the layout is built on.
          "absolute inset-0 m-auto size-[14px] rounded-full border",
          "flex items-center justify-center",
          "after:absolute after:-inset-[9px] after:content-['']",
          "transition-[opacity,background-color,border-color] duration-150 ease-[var(--ease-product)]",
          isDone
            ? "bg-[var(--done)] border-[var(--done)] opacity-100"
            : cn(
                "bg-[var(--surface)] border-[var(--fg-muted)]/50 hover:border-[var(--accent)]",
                "opacity-0",
                onComplete && "group-hover/card:opacity-100 group-focus-within/card:opacity-100",
              ),
        )}
      >
        {isDone ? <Check size={9} className="text-white" strokeWidth={3.5} /> : null}
      </button>
    </span>
  );
}

/**
 * Touch long-press. Dragging inside a horizontally scrolling strip fights
 * the scroll, so on phones a press-and-hold opens the "Move to" sheet
 * instead. Any movement or lift before the threshold cancels it.
 */
function useLongPress(onTrigger: (() => void) | undefined) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = React.useRef(false);

  const cancel = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  React.useEffect(() => cancel, [cancel]);

  if (!onTrigger) return {};

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fired.current = false;
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        onTrigger();
      }, LONG_PRESS_MS);
    },
    onPointerMove: cancel,
    onPointerCancel: cancel,
    onPointerUp: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      // Swallow the click the long-press would otherwise turn into.
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
