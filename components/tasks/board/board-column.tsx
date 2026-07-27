"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  activeTaskId,
  preview,
  onOpen,
  onLongPress,
  onFocusTask,
  onBoardKeyDown,
  registerCard,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  activeTaskId: string | null;
  preview: boolean;
  onOpen: (id: string) => void;
  onLongPress: (task: Task) => void;
  onFocusTask: (id: string) => void;
  onBoardKeyDown: (taskId: string, event: React.KeyboardEvent) => void;
  registerCard: (taskId: string, node: HTMLDivElement | null) => void;
}) {
  const droppable = useDroppable({ id: status, data: { lifecycle: status } });
  const count = tasks.length + (preview ? 1 : 0);

  return (
    <div
      ref={droppable.setNodeRef}
      id={`board-${status}`}
      role="listbox"
      tabIndex={-1}
      aria-label={`${label} tasks`}
      data-status={status}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a,button,[role="option"]')) return;
        const firstTask = tasks[0];
        if (firstTask) onFocusTask(firstTask.id);
      }}
      onPointerUp={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a,button,[role="option"]')) return;
        const firstTask = tasks[0];
        if (firstTask) onFocusTask(firstTask.id);
      }}
      onPointerEnter={() => {
        const firstTask = tasks[0];
        if (firstTask) onFocusTask(firstTask.id);
      }}
      className={cn(
        "flex h-[calc(100dvh-220px)] min-h-[420px] w-[min(82vw,300px)] shrink-0 snap-center flex-col rounded-[var(--radius-lg)]",
        "border border-[var(--border)] bg-[var(--surface-muted)]/70 p-2 md:w-[224px] lg:w-[236px]",
        "transition-[background,border,box-shadow] duration-150 ease-[var(--ease-product)]",
        "motion-reduce:transition-none",
        (droppable.isOver || preview) &&
          "border-[var(--accent)] bg-[var(--accent-soft)]/35 shadow-[0_0_0_1px_var(--accent)]",
      )}
    >
      <div
        className={cn(
          "sticky top-0 z-10 flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-1 text-[13px] font-medium",
          droppable.isOver || preview ? "text-[var(--accent)]" : "text-[var(--fg)]",
        )}
      >
        <StatusIcon status={status} size={16} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-num text-[11px]">{count}</span>
      </div>
      <div className="mt-1 flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            active={activeTaskId === task.id}
            tabIndex={activeTaskId === task.id ? 0 : -1}
            onOpen={onOpen}
            onLongPress={onLongPress}
            onFocusTask={onFocusTask}
            onBoardKeyDown={onBoardKeyDown}
            register={(node) => registerCard(task.id, node)}
          />
        ))}
        {tasks.length === 0 ? (
          <div
            aria-hidden="true"
            className={cn(
              "min-h-[92px] rounded-[var(--radius-md)] border border-dashed border-[var(--border)]",
              "bg-[var(--surface)]/35",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
