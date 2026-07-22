"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { BoardCard } from "./board-card";
import { StatusIcon } from "./status-icon";

/**
 * One status column. The whole column is the drop target (a large,
 * forgiving Fitts target), and `isOver` tints it before release so the
 * destination is obvious while the card is still in hand.
 *
 * Empty columns stay silent — the open space below the header is itself
 * the drop area, no placeholder copy.
 */
export function BoardColumn({
  status,
  tasks,
  labels,
  onOpen,
}: {
  status: Lifecycle;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${statusLabel(status)} column`}
      className={cn(
        "flex w-[272px] shrink-0 flex-col min-h-0 rounded-[var(--radius-lg)]",
        "border bg-[var(--bg-sunken)]/60",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]/30" : "border-transparent",
      )}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <StatusIcon status={status} size={13} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium tracking-[-0.005em] text-[var(--fg-muted)]">
          {statusLabel(status)}
        </h2>
        <span className="text-num text-[11.5px] text-[var(--fg-subtle)]">{tasks.length}</span>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} labels={labels} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
