"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { statusLabel } from "@/lib/domain/status";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import * as React from "react";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  tasks,
  count,
  labels,
  selectedId,
  pulseId,
  countPulse,
  onOpen,
  onComplete,
  onAdd,
  cardRef,
}: {
  status: Lifecycle;
  tasks: Task[];
  /** Display count, including the in-drag preview. */
  count: number;
  labels: Label[];
  selectedId: string | null;
  pulseId: string | null;
  countPulse: boolean;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onAdd: (status: Lifecycle) => void;
  cardRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = statusLabel(status);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${count}`}
      className={cn(
        "flex h-full min-h-0 w-[288px] shrink-0 flex-col rounded-[var(--radius-lg)] border p-1.5",
        "md:w-auto md:min-w-[194px] md:flex-1 md:basis-0",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent-soft)_35%,transparent)]"
          : "border-transparent bg-[var(--bg-sunken)]/50",
      )}
    >
      <header className="flex items-center gap-1.5 px-1.5 pt-1 pb-2">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg)]">{label}</h2>
        <span
          className={cn(
            "text-num ml-auto text-[11.5px] tabular-nums text-[var(--fg-subtle)]",
            countPulse && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>

      <div data-column-scroll="" className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="min-h-[88px] flex-1 rounded-[var(--radius-md)] border border-dashed border-[var(--border)]" />
        ) : (
          tasks.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              labels={labels}
              selected={task.id === selectedId}
              pulse={task.id === pulseId}
              onOpen={onOpen}
              onComplete={onComplete}
              cardRef={(node) => cardRef(task.id, node)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        aria-label={`Add to ${label}`}
        onClick={() => onAdd(status)}
        className="mt-1 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-[12.5px] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-muted)]"
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}
