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
  ghosts = [],
  onDismissGhost,
}: {
  lifecycle: Lifecycle;
  tasks: Task[];
  labels: Label[];
  onOpen: (id: string) => void;
  activeTaskId: string | null;
  activeTaskTabIndex: number;
  highlighted?: boolean;
  columnRef?: React.Ref<HTMLDivElement>;
  ghosts?: Array<{ task: Task; restoreTo: Lifecycle; index: number }>;
  onDismissGhost?: (id: string) => void;
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

  // Same splice as TaskList: a just-completed card stays where it was so the
  // undo checkbox does not jump to the bottom of the column.
  const cards = React.useMemo(() => {
    const out: Array<
      { kind: "task"; task: Task } | { kind: "ghost"; task: Task; restoreTo: Lifecycle }
    > = tasks.map((task) => ({ kind: "task", task }));
    for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
      out.splice(Math.min(g.index, out.length), 0, {
        kind: "ghost",
        task: g.task,
        restoreTo: g.restoreTo,
      });
    }
    return out;
  }, [tasks, ghosts]);

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
        {cards.map((card) => {
          if (card.kind === "ghost") {
            const ghost = card;
            return (
              <div
                key={`ghost-${ghost.task.id}`}
                className="ghost-collapse"
                onAnimationEnd={(e) => {
                  if (e.animationName === "sifty-ghost-collapse") onDismissGhost?.(ghost.task.id);
                }}
              >
                <TaskCard
                  task={ghost.task}
                  labels={labels}
                  onOpen={onOpen}
                  uncompleteTo={ghost.restoreTo}
                  draggable={false}
                />
              </div>
            );
          }
          const task = card.task;
          return (
            <TaskCard
              key={task.id}
              task={task}
              labels={labels}
              onOpen={onOpen}
              active={task.id === activeTaskId}
              tabIndex={task.id === activeTaskId ? activeTaskTabIndex : -1}
            />
          );
        })}
      </div>
    </section>
  );
});
