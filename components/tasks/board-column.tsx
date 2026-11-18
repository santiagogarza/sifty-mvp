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
  labels,
  displayCount,
  isOver,
  pulsing,
  selectedId,
  settledId,
  onOpen,
  onComplete,
  onAdd,
  cardRef,
}: {
  status: Lifecycle;
  tasks: Task[];
  labels: Label[];
  displayCount: number;
  isOver: boolean;
  pulsing: boolean;
  selectedId: string | null;
  settledId: string | null;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onAdd: (lifecycle: Lifecycle) => void;
  cardRef: (id: string, node: HTMLDivElement | null) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });
  const label = statusLabel(status);

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${displayCount}`}
      data-lifecycle={status}
      className={cn(
        "flex h-full w-[288px] shrink-0 snap-start flex-col",
        "md:w-auto md:min-w-[200px] md:flex-1",
        "rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)]/60 p-1.5",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        isOver
          ? "border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent-soft)_35%,transparent)]"
          : "border-transparent",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 px-2 pt-1.5 pb-2">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg-muted)]">{label}</h2>
        <span
          className={cn(
            "text-num text-[11.5px] tabular-nums text-[var(--fg-subtle)]",
            pulsing && "animate-count-pulse",
          )}
        >
          {displayCount}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            selected={task.id === selectedId}
            justFiled={task.id === settledId}
            onOpen={onOpen}
            onComplete={onComplete}
            cardRef={(node) => cardRef(task.id, node)}
          />
        ))}
        {tasks.length === 0 ? (
          <div
            aria-hidden
            className="h-[88px] shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--border)]"
          />
        ) : null}
      </div>

      <button
        type="button"
        aria-label={`Add to ${label}`}
        onClick={() => onAdd(status)}
        className={cn(
          "mt-1.5 flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5",
          "text-[12px] text-[var(--fg-subtle)]",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          "hover:bg-[var(--surface-hover)] hover:text-[var(--fg-muted)]",
        )}
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}
