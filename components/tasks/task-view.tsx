"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { DEFAULT_BOARD_COLUMNS } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { ViewModeToggle } from "./view-mode-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  boardColumns = DEFAULT_BOARD_COLUMNS,
  boardTaskFilter,
  highlightColumn,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** Kanban columns to render. Defaults to full pipeline minus dropped. */
  boardColumns?: readonly Lifecycle[];
  /** Optional lens filter applied before partitioning (e.g. Today). */
  boardTaskFilter?: (task: Task, now: Date) => boolean;
  /** Emphasize and scroll to this column when board mode is active. */
  highlightColumn?: Lifecycle;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  const headerActions = (
    <>
      <ViewModeToggle />
      {rightSlot}
    </>
  );

  const isBoard = viewMode === "board";

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={headerActions}
      />
      {!hydrated ? (
        isBoard ? (
          <TaskBoardSkeleton columns={boardColumns.length} />
        ) : (
          <TaskListSkeleton />
        )
      ) : isBoard ? (
        <TaskBoard
          tasks={tasks}
          columns={boardColumns}
          onOpen={openDetail}
          taskFilter={boardTaskFilter}
          highlightColumn={highlightColumn}
        />
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

function TaskBoardSkeleton({ columns }: { columns: number }) {
  const skeletonKeys = ["a", "b", "c", "d", "e", "f"].slice(0, Math.min(columns, 5));
  return (
    <div className="flex gap-3 overflow-x-hidden pb-2">
      {skeletonKeys.map((key) => (
        <div
          key={key}
          className="flex w-[min(280px,78vw)] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/40"
        >
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-16 w-full rounded-[var(--radius-md)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
