"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import type { TaskViewMode } from "@/lib/store/view-mode";
import * as React from "react";
import { BoardView } from "./board/board-view";
import { ViewToggle } from "./board/view-toggle";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Status views can opt into the List | Board toggle by passing `viewMode` +
 * `onViewModeChange`. Board mode releases the page's status filter — the
 * board always shows the whole pipeline — so the `selector` only drives the
 * list rendering.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  viewMode = "list",
  onViewModeChange,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  viewMode?: TaskViewMode;
  onViewModeChange?: (mode: TaskViewMode) => void;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const board = viewMode === "board";

  const actions =
    rightSlot || onViewModeChange ? (
      <>
        {rightSlot}
        {onViewModeChange ? <ViewToggle mode={viewMode} onChange={onViewModeChange} /> : null}
      </>
    ) : undefined;

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {!hydrated ? (
        board ? (
          <BoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : board ? (
        <BoardView onOpen={openDetail} />
      ) : (
        <TaskList
          tasks={visible}
          onOpen={openDetail}
          emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
        />
      )}
    </>
  );
}

function TaskListSkeleton() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="size-3.5 rounded" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-[60%] mb-1.5" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden pb-1">
      {[0, 1, 2, 3, 4].map((col) => (
        <div
          key={col}
          className="flex w-[300px] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/50 md:w-auto md:min-w-0 md:flex-1"
        >
          <div className="flex h-9 items-center gap-1.5 px-3">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex flex-col gap-2 px-2 pb-2">
            {(col % 2 === 0 ? [0, 1, 2] : [0, 1]).map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              >
                <Skeleton className="h-3.5 w-[85%] mb-1.5" />
                <Skeleton className="h-3 w-[55%]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
