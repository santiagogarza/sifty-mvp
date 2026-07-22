"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  onOpen,
  reducedMotion,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
  reducedMotion: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section className="flex w-[min(100%,272px)] shrink-0 snap-start flex-col" aria-label={label}>
      <header
        className={cn(
          "sticky top-0 z-10 mb-2 flex items-center gap-2 px-1 py-1",
          "rounded-[var(--radius-sm)] bg-[var(--bg)]/90 backdrop-blur-sm",
        )}
      >
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)] opacity-80" />
        <span className="flex-1 text-[13px] font-medium text-[var(--fg)]">{label}</span>
        {tasks.length > 0 ? (
          <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
            {tasks.length}
          </span>
        ) : null}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[140px] flex-1 flex-col gap-2 rounded-[var(--radius-md)] p-1.5",
          "transition-[background-color,box-shadow] duration-150 ease-[var(--ease-product)]",
          isOver && "bg-[var(--surface-muted)] ring-2 ring-[var(--accent)]/25 ring-inset",
        )}
      >
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            onOpen={onOpen}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
    </section>
  );
}
