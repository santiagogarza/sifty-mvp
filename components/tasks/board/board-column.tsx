"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import type { BoardColumnData } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";

/**
 * One board column: a pinned header over a scrolling tray of cards.
 *
 * The column — not the gap between cards — is the drop target (manual
 * ordering is an explicit non-goal, so an insertion line would promise an
 * order the board doesn't keep). While a card hovers a column that isn't its
 * own, the header tints to the accent and its count previews the result, so
 * the outcome is legible before release.
 */
export function BoardColumn({
  column,
  labels,
  selectedTaskId,
  fallbackTabbableId,
  activeDragId,
  activeDragFromStatus,
  onOpen,
  registerCard,
}: {
  column: BoardColumnData;
  labels: Label[];
  selectedTaskId: string | null;
  fallbackTabbableId: string | null;
  activeDragId: string | null;
  activeDragFromStatus: Lifecycle | null;
  onOpen: (id: string) => void;
  registerCard: (taskId: string, el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  const wouldLand = isOver && !!activeDragId && activeDragFromStatus !== column.status;
  const previewCount = wouldLand ? column.tasks.length + 1 : column.tasks.length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-6 items-center gap-1.5 px-1">
        <StatusIcon
          status={column.status}
          size={16}
          className={cn(wouldLand ? "text-[var(--accent)]" : "text-[var(--fg-muted)]")}
        />
        <span
          className={cn(
            "flex-1 truncate text-[13px] font-medium leading-[18px]",
            wouldLand ? "text-[var(--accent)]" : "text-[var(--fg)]",
          )}
        >
          {column.label}
        </span>
        <span
          className={cn(
            "text-num text-[11px] font-medium leading-[14px] tabular-nums",
            wouldLand ? "text-[var(--accent)]" : "text-[var(--fg-subtle)]",
          )}
        >
          {previewCount}
        </span>
      </div>

      <div
        ref={setNodeRef}
        role="listbox"
        aria-label={column.label}
        // Options carry the roving tabindex; the listbox is programmatically
        // focusable only (never a tab stop).
        tabIndex={-1}
        className={cn(
          "mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-[var(--radius-lg)] p-2",
          "border border-[var(--border)] bg-[var(--surface-muted)]/50",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          wouldLand && "border-[var(--accent)]/60 bg-[var(--accent-soft)]/40",
        )}
      >
        {column.tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            labels={labels}
            selected={selectedTaskId === task.id}
            tabbable={
              selectedTaskId === task.id ||
              (selectedTaskId === null && fallbackTabbableId === task.id)
            }
            onOpen={onOpen}
            registerCard={registerCard}
          />
        ))}
        {/* Empty is silent: no copy, just a card-height tray that still reads
            as somewhere to drop. */}
        {column.tasks.length === 0 ? <div className="min-h-[64px]" aria-hidden /> : null}
      </div>
    </div>
  );
}

/**
 * dnd-kit draggable wrapper. Only the pointer `listeners` are spread — not
 * dnd-kit's a11y `attributes`, which would set `role="button"`/`tabIndex` and
 * fight the listbox/option roles and the roving tabindex the board manages.
 * The keyboard *move* is a direct lifecycle change in the board, not dnd-kit's
 * keyboard sensor, so there is nothing here to conflict with `⇧←`/`⇧→`.
 */
function DraggableCard({
  task,
  labels,
  selected,
  tabbable,
  onOpen,
  registerCard,
}: {
  task: Task;
  labels: Label[];
  selected: boolean;
  tabbable: boolean;
  onOpen: (id: string) => void;
  registerCard: (taskId: string, el: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: task.id });

  const composedRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      registerCard(task.id, el);
    },
    [setNodeRef, registerCard, task.id],
  );

  return (
    <BoardCard
      ref={composedRef}
      task={task}
      labels={labels}
      selected={selected}
      ghost={isDragging}
      tabIndex={tabbable ? 0 : -1}
      onOpen={onOpen}
      dragProps={listeners as React.HTMLAttributes<HTMLDivElement>}
    />
  );
}
