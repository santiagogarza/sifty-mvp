"use client";

import { STATUS_ICONS } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  label,
  tasks,
  labelsById,
  activeTaskId,
  onOpenTask,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labelsById: Map<string, Label>;
  activeTaskId: string | null;
  onOpenTask: (id: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const Icon = STATUS_ICONS[status];

  return (
    <section
      ref={setNodeRef}
      data-board-column-id={status}
      aria-labelledby={`board-column-${status}`}
      className={cn(
        "flex h-[calc(100dvh-178px)] min-h-[420px] w-[272px] shrink-0 flex-col rounded-[var(--radius-lg)] border",
        "bg-[var(--bg-sunken)]/40 transition-[background,border-color,box-shadow] duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)] bg-[var(--surface-muted)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)]",
      )}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-sunken)]/95 px-3 py-2.5 backdrop-blur">
        <Icon size={14} className={isOver ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"} />
        <h2
          id={`board-column-${status}`}
          className="flex-1 text-[13px] font-medium text-[var(--fg)]"
        >
          {label}
        </h2>
        <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
          {tasks.length}
        </span>
      </header>

      <div
        className={cn(
          "flex-1 overflow-y-auto p-2.5",
          tasks.length === 0 && "grid min-h-[220px] place-items-stretch",
        )}
      >
        <div
          className={cn(
            "flex min-h-full flex-col gap-2",
            tasks.length === 0 &&
              "rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)]",
          )}
        >
          {tasks.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              labels={task.labelIds.map((id) => labelsById.get(id)).filter(Boolean) as Label[]}
              active={activeTaskId === task.id}
              onOpen={onOpenTask}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
