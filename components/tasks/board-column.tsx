"use client";

import { STATUS_ICONS } from "@/components/tasks/status-icon";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { droppableId } from "@/lib/store/board";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { TaskCard } from "./task-card";

export function BoardColumn({
  lifecycle,
  tasks,
  labels,
  onOpen,
  onComplete,
  selectedTaskId,
  highlighted = false,
  columnRef,
}: {
  lifecycle: Lifecycle;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
  onComplete: (id: string) => void;
  selectedTaskId: string | null;
  highlighted?: boolean;
  columnRef?: React.Ref<HTMLElement>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId(lifecycle) });
  const Icon = STATUS_ICONS[lifecycle];
  const label = statusLabel(lifecycle);

  const setRefs = (node: HTMLElement | null) => {
    setNodeRef(node);
    if (typeof columnRef === "function") columnRef(node);
    else if (columnRef) (columnRef as React.MutableRefObject<HTMLElement | null>).current = node;
  };

  return (
    <section
      ref={setRefs}
      data-testid={`board-column-${lifecycle}`}
      data-column={lifecycle}
      aria-label={label}
      className={cn(
        "flex w-[260px] min-w-[260px] snap-start flex-col self-start",
        "rounded-[var(--radius-lg)] border p-1.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--border-strong)] bg-[var(--surface-muted)]"
          : highlighted
            ? "border-[var(--border-strong)] bg-[var(--bg-sunken)]/80"
            : "border-[var(--border)] bg-[var(--bg-sunken)]/60",
      )}
    >
      <header className="flex items-center gap-2 px-2 pt-1.5 pb-2">
        <Icon size={13} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg-muted)]">{label}</h2>
        <span className="text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]">
          {tasks.length}
        </span>
      </header>

      <div className="flex min-h-[72px] flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            labels={labels}
            onOpen={onOpen}
            onComplete={onComplete}
            active={task.id === selectedTaskId}
            tabIndex={task.id === selectedTaskId ? 0 : -1}
          />
        ))}
      </div>
    </section>
  );
}
