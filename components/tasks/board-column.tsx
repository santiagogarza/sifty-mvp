"use client";

import { STATUS_META } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { StatusIcon } from "./status-icon";
import { DraggableTaskCard } from "./task-card";

/**
 * One board column.
 *
 * The header's word, icon, and position all come from `STATUS_META`, never
 * from a literal typed here — that map exists so the sidebar, the Status
 * picker, and this board can't end up calling the same status three names.
 *
 * An empty column stays as an outlined well rather than collapsing or
 * apologising: the shape of the pipeline is the point of the view, and a
 * column that vanishes when it empties takes that shape with it.
 */
export const BoardColumn = React.memo(function BoardColumn({
  status,
  tasks,
  selectedId,
  focusableId,
  onOpen,
  onFocusTask,
  registerRef,
  emphasis = false,
}: {
  status: Lifecycle;
  tasks: Task[];
  selectedId: string | null;
  /** The board's single tab stop, under a roving tabindex. */
  focusableId: string | null;
  onOpen: (id: string) => void;
  onFocusTask: (id: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  /** Marks the column matching the route the board was opened from. */
  emphasis?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = STATUS_META[status];

  return (
    <section
      className={cn(
        "flex w-[264px] shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] p-2",
        "border transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
          : emphasis
            ? "border-[var(--border-strong)] bg-[var(--surface-muted)]/50"
            : "border-transparent bg-[var(--surface-muted)]/30",
      )}
      aria-label={meta.label}
    >
      <header className="flex items-center gap-2 px-1 pt-0.5">
        <StatusIcon status={status} size={13} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg)]">{meta.label}</h2>
        {tasks.length > 0 ? (
          <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
            {tasks.length}
          </span>
        ) : null}
      </header>

      <div
        ref={setNodeRef}
        role="listbox"
        aria-label={meta.label}
        data-column-status={status}
        // Focus lands on a card, never here; -1 keeps the listbox reachable
        // programmatically without adding a tab stop per column.
        tabIndex={-1}
        className="flex min-h-[96px] flex-col gap-1.5 rounded-[var(--radius-md)] focus:outline-none"
      >
        {tasks.map((task) => (
          <DraggableTaskCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onFocusTask={onFocusTask}
            selected={task.id === selectedId}
            tabIndex={task.id === focusableId ? 0 : -1}
            registerRef={registerRef}
          />
        ))}
      </div>
    </section>
  );
});
