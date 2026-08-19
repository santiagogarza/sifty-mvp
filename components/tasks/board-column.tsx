"use client";

import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import type { Label } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { useDroppable } from "@dnd-kit/core";
import * as React from "react";
import { StatusIcon } from "./status-icon";
import { TaskCard } from "./task-card";

export const BoardColumn = React.memo(function BoardColumn({
  lifecycle,
  tasks,
  labels,
  onOpen,
  activeTaskId,
  activeTaskTabIndex,
  highlighted,
  columnRef,
}: {
  lifecycle: Lifecycle;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
  activeTaskId: string | null;
  activeTaskTabIndex: number;
  highlighted?: boolean;
  columnRef?: React.Ref<HTMLDivElement>;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: lifecycle,
    data: { lifecycle },
  });

  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      if (typeof columnRef === "function") columnRef(node);
      else if (columnRef && "current" in columnRef) {
        (columnRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [setNodeRef, columnRef],
  );

  return (
    <section
      ref={mergedRef}
      aria-label={statusLabel(lifecycle)}
      data-lifecycle={lifecycle}
      className={cn(
        "flex h-full min-h-[200px] w-[min(280px,78vw)] shrink-0 flex-col",
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/40",
        highlighted && "ring-2 ring-[var(--accent)]/25",
        isOver && "border-[var(--accent)]/50 bg-[var(--accent)]/5",
      )}
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <StatusIcon status={lifecycle} size={14} className="text-[var(--fg-muted)]" />
        <h2 className="text-[12.5px] font-medium text-[var(--fg)]">{statusLabel(lifecycle)}</h2>
        <span className="ml-auto text-num text-[11px] text-[var(--fg-subtle)]">{tasks.length}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            labels={labels}
            onOpen={onOpen}
            active={task.id === activeTaskId}
            tabIndex={task.id === activeTaskId ? activeTaskTabIndex : -1}
          />
        ))}
      </div>
    </section>
  );
});
