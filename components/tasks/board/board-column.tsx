"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import { Skeleton } from "@/components/ui/skeleton";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard, BoardCardGhost } from "./board-card";

/**
 * One status column. The column body is the drop target (not inter-card gaps) —
 * Fitts's Law and an honest feedforward tint/count preview.
 */
export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  selectedTaskId,
  draggingTaskId,
  over,
  previewCount,
  settlingTaskId,
  cardRefs,
  onOpen,
  onSelect,
  onLongPress,
  draggable,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  selectedTaskId: string | null;
  draggingTaskId: string | null;
  over: boolean;
  previewCount: number | null;
  settlingTaskId: string | null;
  cardRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  onOpen: (id: string) => void;
  onSelect: (id: string) => void;
  onLongPress?: (id: string) => void;
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: "column", status },
  });

  const highlighted = over || isOver;
  const count = previewCount ?? tasks.length;
  const countPulsing = previewCount !== null && previewCount !== tasks.length;

  return (
    <section
      ref={setNodeRef}
      data-column={status}
      aria-label={`${label}, ${count} tasks`}
      className={cn(
        "flex w-[min(300px,85vw)] md:w-[194px] shrink-0 flex-col",
        "snap-center md:snap-align-none",
        "rounded-[var(--radius-lg)] border border-[var(--border)]",
        "bg-[var(--surface-muted)]/70",
        "transition-colors duration-150 ease-[var(--ease-product)]",
        highlighted && "bg-[var(--accent-soft)]/50 border-[var(--accent)]/35",
      )}
    >
      <header className="sticky top-0 z-10 flex items-center gap-1.5 px-2.5 py-2">
        <StatusIcon status={status} size={13} className="opacity-70" />
        <h2 className="flex-1 truncate text-[12.5px] font-medium text-[var(--fg)]">{label}</h2>
        <span
          className={cn(
            "text-num text-[11px] text-[var(--fg-subtle)] tabular-nums",
            countPulsing && "animate-count-pulse text-[var(--accent)]",
          )}
        >
          {count}
        </span>
      </header>

      <div
        role="listbox"
        aria-label={label}
        className={cn(
          "flex flex-1 flex-col gap-2 px-2 pb-2 min-h-[72px] overflow-y-auto",
          "max-h-[calc(100dvh-220px)] md:max-h-[calc(100dvh-180px)]",
        )}
      >
        {tasks.map((task) => {
          if (draggingTaskId === task.id) {
            return <BoardCardGhost key={`ghost-${task.id}`} />;
          }
          return (
            <BoardCard
              key={task.id}
              ref={(el) => {
                cardRefs.current.set(task.id, el);
              }}
              task={task}
              labels={labels}
              selected={selectedTaskId === task.id}
              tabIndex={selectedTaskId === task.id ? 0 : -1}
              draggable={draggable}
              settling={settlingTaskId === task.id}
              onOpen={onOpen}
              onSelect={onSelect}
              onLongPress={onLongPress}
            />
          );
        })}
      </div>
    </section>
  );
}

export function BoardColumnSkeleton() {
  return (
    <div className="flex w-[194px] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/70 p-2 gap-2">
      <div className="flex items-center gap-1.5 px-0.5 py-1">
        <Skeleton className="size-3.5 rounded" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="ml-auto h-3 w-4" />
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2"
        >
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3 w-[60%]" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}
