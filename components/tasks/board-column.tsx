"use client";

import type { Label, Task } from "@/lib/domain/types";
import type { BoardStatus } from "@/lib/ui/board";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { BoardCard } from "./board-card";
import { StatusIcon } from "./status-icon";

export function BoardColumn({
  status,
  label,
  tasks,
  count,
  tinted,
  pulse,
  labelById,
  selectedId,
  landedId,
  onOpen,
  onComplete,
  onAdd,
}: {
  status: BoardStatus;
  label: string;
  tasks: Task[];
  count: number;
  tinted: boolean;
  pulse: boolean;
  labelById: Map<string, Label>;
  selectedId: string | null;
  landedId: string | null;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onAdd?: (status: BoardStatus) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${count}`}
      className={cn(
        "flex h-full min-h-0 w-[288px] shrink-0 flex-col rounded-[var(--radius-lg)] border bg-[var(--surface-muted)]/40",
        "md:w-auto md:min-w-[200px] md:flex-1",
        tinted
          ? "border-[var(--accent)] bg-[color-mix(in_oklch,var(--accent-soft)_35%,transparent)]"
          : "border-[var(--border)]",
      )}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <span className="text-[13px] font-medium tracking-[-0.01em] text-[var(--fg)]">{label}</span>
        <span
          className={cn(
            "ml-auto text-num text-[12px] text-[var(--fg-subtle)]",
            pulse && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-1">
        {tasks.length === 0 ? <div className="min-h-[88px] flex-1" /> : null}
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labelById={labelById}
            selected={task.id === selectedId}
            landed={task.id === landedId}
            onOpen={onOpen}
            onComplete={onComplete}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onAdd?.(status)}
        className="mx-2 mb-2 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--fg-subtle)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}
