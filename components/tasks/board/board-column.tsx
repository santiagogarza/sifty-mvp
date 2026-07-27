"use client";

import { StatusIcon } from "@/components/tasks/status-icon";
import type { Label, Task } from "@/lib/domain/types";
import type { BoardColumnData } from "@/lib/store/selectors";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { BoardCard } from "./board-card";

export function BoardColumn({
  column,
  labels,
  activeTaskId,
  activeTaskTabIndex,
  isDropTarget,
  dropPreviewCount,
  onOpen,
  onLongPress,
  onBoardKeyDown,
  dragDisabled,
  cardRef,
  columnIndex,
  onColumnFocus,
}: {
  column: BoardColumnData;
  labels: Label[];
  activeTaskId: string | null;
  activeTaskTabIndex: (taskId: string) => number;
  isDropTarget?: boolean;
  dropPreviewCount?: number;
  onOpen: (id: string) => void;
  onLongPress?: (task: Task) => void;
  onBoardKeyDown?: (e: React.KeyboardEvent) => void;
  dragDisabled?: boolean;
  cardRef?: (taskId: string) => React.Ref<HTMLDivElement>;
  columnIndex: number;
  onColumnFocus?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.status}`,
    data: { status: column.status },
  });

  const showDrop = isOver || isDropTarget;
  const count = showDrop && dropPreviewCount !== undefined ? dropPreviewCount : column.tasks.length;

  return (
    <div
      className={cn(
        "flex flex-col min-w-[260px] w-[260px] sm:min-w-[280px] sm:w-[280px] shrink-0 snap-center",
        "h-full max-h-[calc(100dvh-220px)] md:max-h-[calc(100dvh-180px)]",
      )}
    >
      <header className="flex items-center gap-2 px-1 pb-3">
        <StatusIcon status={column.status} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[13px] font-medium text-[var(--fg)]">{column.label}</h2>
        <span
          className={cn(
            "text-num text-[11px] rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
            "transition-colors duration-150",
            showDrop
              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
              : "bg-[var(--surface-muted)] text-[var(--fg-muted)]",
          )}
        >
          {count}
        </span>
      </header>
      <div
        ref={setNodeRef}
        role="listbox"
        aria-label={column.label}
        tabIndex={-1}
        onFocus={onColumnFocus}
        data-column-index={columnIndex}
        className={cn(
          "flex-1 flex flex-col gap-2 overflow-y-auto rounded-[var(--radius-lg)] p-2 -mx-2",
          "transition-colors duration-150 ease-[var(--ease-product)]",
          showDrop && "bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/20",
        )}
      >
        {column.tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            labels={labels}
            active={activeTaskId === task.id}
            tabIndex={activeTaskTabIndex(task.id)}
            onOpen={onOpen}
            onLongPress={onLongPress}
            onBoardKeyDown={onBoardKeyDown}
            dragDisabled={dragDisabled}
            cardRef={cardRef?.(task.id)}
          />
        ))}
      </div>
    </div>
  );
}
