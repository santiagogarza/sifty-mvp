"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";

/**
 * A single Kanban column: a droppable target for one `Lifecycle`.
 *
 * The header (icon + label + count) sits above the card stack and stays put
 * while the stack scrolls, so the column always announces what it is. The
 * drop area covers the whole stack — including empty space — so a card can be
 * dropped into an empty column. `isOver` paints an accent ring + tint the
 * instant a card hovers, giving feedforward before release.
 *
 * Empty columns are deliberately silent: no "drop here" placeholder. Absence
 * of work reads as calm, and the ring already signals a valid target.
 */
export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  onOpen,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      aria-label={`${label} column`}
      className="flex min-h-0 w-[268px] shrink-0 flex-col snap-start"
    >
      <div className="flex items-center gap-2 px-1.5 pb-2">
        <StatusIcon status={status} className="text-[var(--fg-muted)]" />
        <h2 className="text-[13px] font-medium tracking-[-0.005em] text-[var(--fg)]">{label}</h2>
        {tasks.length > 0 ? (
          <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
            {tasks.length}
          </span>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-lg)] p-1.5",
          "border border-transparent",
          "transition-[background-color,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
          isOver &&
            "border-[var(--accent)]/40 bg-[var(--surface-muted)] ring-1 ring-[var(--accent)]/25",
        )}
      >
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} labels={labels} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
