"use client";

import { STATUS_META } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { STATUS_ICONS } from "./status-icon";
import { TaskCard } from "./task-card";

export const BoardColumn = React.memo(function BoardColumn({
  lifecycle,
  tasks,
  labels,
  selectedTaskId,
  emphasized = false,
  onOpen,
  onSelect,
}: {
  lifecycle: Lifecycle;
  tasks: Task[];
  labels: Label[];
  selectedTaskId: string | null;
  emphasized?: boolean;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: lifecycle,
    data: { lifecycle },
  });
  const Icon = STATUS_ICONS[lifecycle];
  const meta = STATUS_META[lifecycle];

  return (
    <section
      ref={setNodeRef}
      aria-label={`${meta.label}, ${tasks.length} tasks`}
      data-board-column={lifecycle}
      className={cn(
        "flex w-[260px] shrink-0 flex-col rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)]/65",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        emphasized && "border-[var(--border-strong)]",
        isOver && "border-[var(--accent)] bg-[var(--accent-soft)]/35",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Icon size={14} className="text-[var(--fg-muted)]" aria-hidden="true" />
        <h2 className="text-[12px] font-medium text-[var(--fg)]">{meta.label}</h2>
        <span className="text-num ml-auto text-[11px] text-[var(--fg-subtle)]">{tasks.length}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2" role="group" aria-label={meta.label}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            labels={labels}
            selected={task.id === selectedTaskId}
            onOpen={onOpen}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
});
