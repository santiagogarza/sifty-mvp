"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { MutableRefObject } from "react";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  count,
  selectedId,
  settledId,
  isOver,
  pulseKey,
  ignoreClick,
  onOpen,
  onComplete,
  onSelect,
  onAdd,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  count: number;
  selectedId: string | null;
  settledId: string | null;
  isOver: boolean;
  pulseKey: number | null;
  ignoreClick: MutableRefObject<boolean>;
  onOpen: (id: string) => void;
  onComplete: (task: Task) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${count}`}
      data-column={status}
      style={
        isOver
          ? { background: "color-mix(in oklch, var(--accent-soft) 35%, var(--surface-muted))" }
          : undefined
      }
      className={cn(
        "flex w-[288px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface-muted)]",
        "min-h-0 max-h-[calc(100dvh-18rem)] md:max-h-[calc(100dvh-14rem)]",
        "md:w-auto md:min-w-[180px] md:flex-1 md:basis-[180px]",
        isOver ? "border-[var(--accent)]" : "border-[var(--border)]",
      )}
    >
      <header className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2.5 pb-1.5">
        <StatusIcon status={status} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[13px] font-medium text-[var(--fg)]">{label}</h2>
        <span
          key={pulseKey ?? "rest"}
          className={cn(
            "text-num text-[12px] text-[var(--fg-subtle)]",
            pulseKey !== null && "animate-count-pulse",
          )}
        >
          {count}
        </span>
      </header>
      <div
        role="list"
        aria-label={label}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {tasks.length === 0 ? (
          <div className="min-h-[88px] rounded-[var(--radius-md)] border border-dashed border-[var(--border)]" />
        ) : (
          tasks.map((task) => (
            <BoardCard
              key={task.id}
              task={task}
              labels={labels}
              selected={task.id === selectedId}
              settled={task.id === settledId}
              ignoreClick={ignoreClick}
              onOpen={onOpen}
              onComplete={onComplete}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] text-[var(--fg-subtle)] hover:text-[var(--fg)]"
      >
        <Plus size={12} />
        Add
      </button>
    </section>
  );
}
