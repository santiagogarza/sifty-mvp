"use client";

import type { Label, Lifecycle, Task } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import { StatusIcon } from "../status-icon";
import { BoardCard } from "./board-card";

export function BoardColumn({
  status,
  label,
  tasks,
  labels,
  activeId,
  draggingFrom,
  mobile,
  onOpen,
  onFocus,
  onLongPress,
  registerRef,
}: {
  status: Lifecycle;
  label: string;
  tasks: Task[];
  labels: Label[];
  activeId: string | null;
  draggingFrom: Lifecycle | null;
  mobile: boolean;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  onLongPress: (task: Task) => void;
  registerRef: (id: string, element: HTMLDivElement | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const previewCount = isOver && draggingFrom !== status ? tasks.length + 1 : tasks.length;

  return (
    <div
      ref={setNodeRef}
      role="listbox"
      tabIndex={-1}
      aria-label={`${label} tasks`}
      className={cn(
        "flex h-[min(64vh,640px)] w-[min(78vw,300px)] shrink-0 snap-center flex-col rounded-[var(--radius-lg)] border bg-[var(--surface-muted)] p-2 md:h-[calc(100dvh-230px)] md:min-h-[320px] md:min-w-[178px] md:flex-1",
        "transition-[background-color,border-color] duration-150 ease-[var(--ease-product)]",
        isOver && draggingFrom !== status && "border-[var(--accent)] bg-[var(--accent-soft)]/45",
      )}
      data-status={status}
    >
      <header
        className={cn(
          "flex h-7 shrink-0 items-center gap-1 px-1 text-[13px] font-medium",
          isOver && draggingFrom !== status ? "text-[var(--accent)]" : "text-[var(--fg)]",
        )}
      >
        <StatusIcon status={status} size={16} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-num text-[11px] text-current opacity-60">{previewCount}</span>
      </header>
      <div className="mt-1 flex min-h-[78px] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            active={activeId === task.id}
            tabIndex={activeId === task.id ? 0 : -1}
            mobile={mobile}
            onOpen={onOpen}
            onFocus={onFocus}
            onLongPress={onLongPress}
            registerRef={(element) => registerRef(task.id, element)}
          />
        ))}
      </div>
    </div>
  );
}
