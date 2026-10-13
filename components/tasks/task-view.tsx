"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lifecycle, Task } from "@/lib/domain/types";
import type { BoardPartitionArgs } from "@/lib/store/board";
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
  boardColumns,
  boardArgs,
  emphasizedColumn,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  boardColumns?: readonly Lifecycle[];
  boardArgs?: BoardPartitionArgs;
  emphasizedColumn?: Lifecycle;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const actions = (
    <>
      {rightSlot}
      <ViewModeToggle />
    </>
  );

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {!hydrated ? (
        viewMode === "board" ? (
          <TaskBoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : viewMode === "board" ? (
        <TaskBoard
          tasks={tasks}
          onOpen={openDetail}
          columns={boardColumns}
          partitionArgs={boardArgs}
          emphasizedColumn={emphasizedColumn}
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

function TaskBoardSkeleton() {
  return (
    <div className="touch-pan-x overflow-hidden pb-5">
      <div className="flex min-w-max gap-3">
        {[0, 1, 2].map((column) => (
          <div
            key={column}
            className="w-[260px] rounded-[var(--radius-lg)] border bg-[var(--bg-sunken)]/65 p-2"
          >
            <div className="flex h-9 items-center gap-2 px-1">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} className="mb-2 h-20 w-full rounded-[var(--radius-lg)]" />
            ))}
          </div>
        ))}
      </div>
    </div>
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
