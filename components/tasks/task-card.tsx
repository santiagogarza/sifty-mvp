"use client";

import { Badge } from "@/components/ui/badge";
import { assigneeDisplayValue } from "@/lib/domain/assignee";
import type { Label, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { formatRelativeDay, isOverdue, isToday } from "@/lib/utils/dates";
import { useDraggable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import * as React from "react";
import { AiStatusInline } from "./ai-status";
import { PriorityGlyph } from "./priority-glyph";

/**
 * A single board card. Chrome deliberately mirrors `TaskRow` — the same
 * complete circle, `PriorityGlyph`, due/label `Badge`s and `AiStatusInline`
 * — so a task reads the same in both views.
 *
 * Drag notes:
 *  - The card is the draggable; the column is the droppable. While dragging,
 *    the source dims in place (columns never reflow mid-drag) and the
 *    floating clone is rendered by the board's `DragOverlay`.
 *  - A completed drag is followed by a native `click` on the source card,
 *    which must not open the detail sheet. `wasDragged` is armed when a drag
 *    activates and disarmed on the next fresh pointerdown, so a plain click
 *    (under the sensor's 5px activation distance) still opens the sheet.
 *  - `touch-action: manipulation` keeps pre-drag swipes scrolling the page
 *    while the touch sensor's long-press delay decides drag vs scroll.
 */
export const TaskCard = React.memo(function TaskCard({
  task,
  labelMap,
  onOpen,
  onSelect,
  selected = false,
  cardRef,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  selected?: boolean;
  cardRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: task.id });
  const wasDragged = React.useRef(false);

  React.useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  const setRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      cardRef(task.id, el);
    },
    [setNodeRef, cardRef, task.id],
  );

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      // The board uses the aria-activedescendant pattern: the listbox keeps
      // focus and points at this id, so cards are never tab stops and a
      // remount (moving columns) can never drop keyboard focus.
      id={`board-card-${task.id}`}
      role="option"
      aria-selected={selected}
      // Not focusable (overrides the useDraggable default of 0): a click
      // focuses the listbox ancestor instead, so a card that then moves
      // columns (and unmounts) can never take keyboard focus down with it.
      tabIndex={undefined}
      onPointerDownCapture={() => {
        wasDragged.current = false;
        onSelect(task.id);
      }}
      onClick={() => {
        if (wasDragged.current) {
          // Consume the flag so an assistive-tech click (which has no
          // preceding pointerdown) can never be swallowed by a stale drag.
          wasDragged.current = false;
          return;
        }
        onOpen(task.id);
      }}
      className={cn(
        "animate-fade-in [touch-action:manipulation] focus:outline-none",
        isDragging && "opacity-35",
      )}
    >
      <TaskCardContent task={task} labelMap={labelMap} selected={selected} />
    </div>
  );
});

/**
 * The card's visual body, shared between the in-column card and the
 * `DragOverlay` clone so the floating card is pixel-identical.
 */
export function TaskCardContent({
  task,
  labelMap,
  selected = false,
  overlay = false,
}: {
  task: Task;
  labelMap: Map<string, Label>;
  selected?: boolean;
  overlay?: boolean;
}) {
  const updateTask = useStore((s) => s.updateTask);

  const taskLabels = task.labelIds.map((id) => labelMap.get(id)).filter(Boolean) as Label[];
  const overdue = isOverdue(task.due);
  const dueLabel = formatRelativeDay(task.due);
  const dueTone: "rose" | "ember" | "neutral" = overdue
    ? "rose"
    : isToday(task.due)
      ? "ember"
      : "neutral";
  const assignee = task.delegationCandidate === "person" ? assigneeDisplayValue(task) : null;

  const isDone = task.lifecycle === "done";
  // Mirror AiStatusInline's own render condition so in-flight triage shows.
  const showAiStatus = task.aiStatus !== "ready" && task.aiStatus !== "idle";
  const hasMeta = dueLabel || taskLabels.length > 0 || assignee || showAiStatus;

  const onComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(task.id, { lifecycle: isDone ? "active" : "done" });
  };

  return (
    <div
      className={cn(
        "surface-card rounded-[var(--radius-md)] px-2.5 py-2",
        "transition-shadow duration-150 ease-[var(--ease-product)]",
        overlay
          ? "border-[var(--border-strong)] shadow-lg scale-[1.02]"
          : "hover:border-[var(--border-strong)]",
        selected && !overlay && "border-[var(--border-strong)] bg-[var(--surface-muted)]",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onComplete}
          // Completing sends the card to another column and unmounts this
          // button; don't let the press move focus into it first.
          onMouseDown={(e) => e.preventDefault()}
          aria-label={isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            // Visible circle is 16px; the ::after pseudo pads the hit target
            // to ~28px (Fitts) without inflating the compact card layout.
            "relative mt-px size-4 shrink-0 rounded-full border flex items-center justify-center",
            "after:absolute after:-inset-1.5 after:content-['']",
            "transition-all duration-150 ease-[var(--ease-product)]",
            !isDone &&
              "bg-[var(--surface-muted)] border-[var(--fg-muted)]/40 hover:bg-[var(--surface-hover)] hover:border-[var(--accent)]",
            isDone && "bg-[var(--done)] border-[var(--done)]",
          )}
        >
          {isDone ? <Check size={10} className="text-white" strokeWidth={3} /> : null}
        </button>
        <PriorityGlyph bucket={task.priorityBucket} className="mt-[3px] shrink-0" />
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-[1.4] tracking-[-0.005em] line-clamp-2",
            isDone ? "text-[var(--fg-subtle)] line-through decoration-[1.5px]" : "text-[var(--fg)]",
          )}
        >
          {task.title}
        </span>
      </div>
      {hasMeta ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11">
          {dueLabel ? (
            <Badge tone={dueTone} variant={dueTone === "neutral" ? "outline" : "soft"}>
              {dueLabel}
            </Badge>
          ) : null}
          {assignee ? (
            <Badge tone="neutral" variant="outline" className="max-w-[120px]">
              <span className="truncate">{assignee}</span>
            </Badge>
          ) : null}
          {taskLabels.slice(0, 2).map((label) => (
            <Badge key={label.id} tone={label.tone}>
              {label.name}
            </Badge>
          ))}
          {taskLabels.length > 2 ? (
            <span className="text-[11px] text-[var(--fg-subtle)]">+{taskLabels.length - 2}</span>
          ) : null}
          <AiStatusInline status={task.aiStatus} />
        </div>
      ) : null}
    </div>
  );
}
