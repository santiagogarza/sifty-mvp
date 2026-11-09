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

/**
 * A task as a board card. It carries only what helps decide where a task
 * goes — title, next action, priority, due, and one more badge (the person
 * it's handed to, otherwise its first label). Everything else stays in the
 * detail sheet.
 *
 * Border colors use `!`: the unlayered `* { border-color }` base rule in
 * globals.css outranks layered Tailwind utilities. The same goes for the
 * radius/outline that the global `:focus-visible` rule would impose; the
 * selected border is the board's focus indicator.
 */

const CARD_BASE = "relative !rounded-[var(--radius-md)] border bg-[var(--surface)] p-3";

export const BoardCard = React.memo(function BoardCard({
  task,
  labelsById,
  selected,
  tabbable,
  settling,
  onOpen,
  onFocusCard,
  onToggleComplete,
  registerNode,
}: {
  task: Task;
  labelsById: ReadonlyMap<string, Label>;
  /** Keyboard selection, shown as the accent border. */
  selected: boolean;
  /** Roving tabindex: exactly one card on the board is a tab stop. */
  tabbable: boolean;
  /** Just landed in this column — plays the settle animation. */
  settling: boolean;
  onOpen: (id: string) => void;
  onFocusCard: (id: string) => void;
  onToggleComplete: (task: Task) => void;
  registerNode: (id: string, node: HTMLElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.lifecycle },
  });

  const ref = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      registerNode(task.id, node);
    },
    [setNodeRef, registerNode, task.id],
  );

  return (
    <div
      ref={ref}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-roledescription="task card"
      aria-label={task.title}
      data-task-id={task.id}
      data-selected={selected || undefined}
      onClick={() => onOpen(task.id)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) onFocusCard(task.id);
      }}
      className={cn(
        CARD_BASE,
        "group cursor-grab touch-manipulation select-none !outline-none",
        "transition-[border-color,box-shadow] duration-[120ms] ease-[var(--ease-product)]",
        "hover:!border-[var(--border-strong)] hover:shadow-[var(--shadow-raised)]",
        selected && "!border-[var(--accent)] hover:!border-[var(--accent)] hover:shadow-none",
        // The source slot stays in place as a dashed ghost so the column
        // never reflows mid-drag; the floating copy is the DragOverlay.
        isDragging &&
          "!border-dashed !border-[var(--border-strong)] bg-transparent shadow-none hover:shadow-none [&>*]:invisible",
        settling && !isDragging && "animate-settle",
      )}
    >
      <BoardCardFace
        task={task}
        labelsById={labelsById}
        revealComplete={selected}
        onToggleComplete={onToggleComplete}
      />
    </div>
  );
});

/** The floating copy under the pointer while a card is dragged. */
export function BoardCardOverlay({
  task,
  labelsById,
}: {
  task: Task;
  labelsById: ReadonlyMap<string, Label>;
}) {
  return (
    <div
      className={cn(
        CARD_BASE,
        "!border-[var(--accent)] cursor-grabbing animate-lift will-change-transform",
      )}
    >
      <BoardCardFace task={task} labelsById={labelsById} revealComplete={false} />
    </div>
  );
}

function BoardCardFace({
  task,
  labelsById,
  revealComplete,
  onToggleComplete,
}: {
  task: Task;
  labelsById: ReadonlyMap<string, Label>;
  revealComplete: boolean;
  onToggleComplete?: (task: Task) => void;
}) {
  const isDone = task.lifecycle === "done";
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = isOverdue(task.due)
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;
  const firstLabel = assignee
    ? undefined
    : task.labelIds.map((id) => labelsById.get(id)).find((l): l is Label => !!l);
  const showAi = task.aiStatus !== "ready" && task.aiStatus !== "idle";
  const hasMeta = !!dueLabel || !!assignee || !!firstLabel || showAi;

  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2">
      {/* Priority glyph at rest; the complete circle takes the same slot on
          hover or selection (always shown once done), so nothing reflows. */}
      <div className="relative flex h-[18px] items-center justify-center">
        {isDone ? null : (
          <PriorityGlyph
            bucket={task.priorityBucket}
            className={cn(
              "transition-opacity duration-150",
              revealComplete ? "opacity-0" : "group-hover:opacity-0",
            )}
          />
        )}
        {onToggleComplete ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isDone ? "Mark as not done" : "Mark as done"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(task);
            }}
            // Never let the circle start a drag or open the card.
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className={cn(
              "absolute inset-0 m-auto flex size-4 items-center justify-center rounded-full border",
              "after:absolute after:-inset-2 after:content-['']",
              "transition-[opacity,background-color,border-color] duration-150 ease-[var(--ease-product)]",
              isDone
                ? "bg-[var(--done)] !border-[var(--done)]"
                : cn(
                    "bg-[var(--surface)] !border-[var(--fg-subtle)] hover:!border-[var(--accent)]",
                    revealComplete ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  ),
            )}
          >
            {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
          </button>
        ) : isDone ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-[var(--done)]">
            <Check size={10} className="text-white" strokeWidth={3} />
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p
          className={cn(
            "line-clamp-2 break-words text-[13px] leading-[1.4] tracking-[-0.005em]",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </p>
        {task.nextAction && !isDone ? (
          <p className="mt-0.5 truncate text-[12px] leading-[1.45] text-[var(--fg-muted)]">
            {task.nextAction}
          </p>
        ) : null}
        {hasMeta ? (
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {dueLabel ? (
              <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
                {dueLabel}
              </Badge>
            ) : null}
            {assignee ? (
              <Badge tone="neutral" variant="outline" className="max-w-full">
                <span className="truncate">{assignee}</span>
              </Badge>
            ) : firstLabel ? (
              <Badge tone={firstLabel.tone} className="max-w-full">
                <span className="truncate">{firstLabel.name}</span>
              </Badge>
            ) : null}
            {showAi ? <AiStatusInline status={task.aiStatus} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
