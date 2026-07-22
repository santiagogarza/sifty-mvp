"use client";

import { BoardCard } from "@/components/tasks/board-card";
import { StatusIcon } from "@/components/tasks/status-icon";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";

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
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: { lifecycle: status },
  });
  const label = statusLabel(status);

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`board-column-${status}`}
      className={cn(
        "flex min-h-[360px] w-[min(82vw,280px)] shrink-0 flex-col overflow-hidden",
        "rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)]/55",
        "transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)]/70 bg-[var(--accent-soft)]/30 shadow-[0_0_0_2px_var(--accent-soft)]"
          : "border-[var(--border)]",
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2.5",
          "border-[var(--border)] bg-[var(--bg-sunken)]/90 backdrop-blur",
        )}
      >
        <StatusIcon
          status={status}
          size={14}
          className={isOver ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
        />
        <h2
          id={`board-column-${status}`}
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--fg)]"
        >
          {label}
        </h2>
        <span
          className="text-num min-w-5 rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-center text-[10.5px] text-[var(--fg-subtle)]"
          aria-label={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        >
          {tasks.length}
        </span>
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} labels={labels} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
