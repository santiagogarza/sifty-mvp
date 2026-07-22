"use client";

import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";
import { StatusIcon } from "./status-icon";

/**
 * One status column. The whole column — header included — is the drop
 * target (a bigger target is a kinder target), while only the card well
 * lights up so the feedback reads as "the stack will receive it".
 *
 * An empty column is just an open well: droppable, no placeholder copy.
 */
export function BoardColumn({
  status,
  label,
  tasks,
  labelMap,
  onOpen,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labelMap: Map<string, Label>;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label} column`}
      className="flex min-h-0 min-w-[224px] flex-1 flex-col"
    >
      <header className="flex items-center gap-2 px-2 pb-2">
        <StatusIcon status={status} size={13} className="text-[var(--fg-muted)]" />
        <h2 className="text-[13px] font-medium text-[var(--fg)]">{label}</h2>
        {tasks.length > 0 ? (
          <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">{tasks.length}</span>
        ) : null}
      </header>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-[var(--radius-lg)] p-1.5",
          "transition-[background-color,box-shadow] duration-150 ease-[var(--ease-product)]",
          isOver
            ? "bg-[var(--surface-muted)] ring-1 ring-inset ring-[var(--accent)]/35"
            : "bg-[var(--surface-muted)]/50",
        )}
      >
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} labelMap={labelMap} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
