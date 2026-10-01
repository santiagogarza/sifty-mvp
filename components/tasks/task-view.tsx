"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import type { ViewArgs } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS, TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { ViewModeToggle } from "./view-mode-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Board mode drops the route's lifecycle filter and shows the pipeline
 * (or a caller-supplied column set). Label/search filters stay on via
 * `viewArgs`.
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
  boardTasks,
  viewArgs,
  allowDropped,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  boardColumns?: readonly Lifecycle[];
  /** Pre-filter for the board (Today). Default: every task. */
  boardTasks?: (tasks: Task[], args: ViewArgs) => Task[];
  viewArgs?: ViewArgs;
  allowDropped?: boolean;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);
  const args = viewArgs ?? {};

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const boardSource = React.useMemo(
    () => (boardTasks ? boardTasks(tasks, args) : tasks),
    [boardTasks, tasks, args],
  );

  const board = hydrated && viewMode === "board";
  const header = (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={
        <div className="flex items-center gap-2">
          {rightSlot}
          <ViewModeToggle />
        </div>
      }
    />
  );

  return (
    <>
      {board ? (
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>{header}</div>
      ) : (
        header
      )}
      {!hydrated ? (
        viewMode === "board" ? (
          <TaskBoardSkeleton columns={boardColumns} />
        ) : (
          <TaskListSkeleton />
        )
      ) : board ? (
        <TaskBoard
          tasks={boardSource}
          viewArgs={args}
          columns={boardColumns}
          allowDropped={allowDropped ?? boardColumns === undefined}
          onOpen={openDetail}
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

function TaskBoardSkeleton({ columns }: { columns?: readonly Lifecycle[] }) {
  const cols = columns ?? STATUSES_IN_ORDER.filter((s) => s !== "dropped");
  return (
    <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS, "flex gap-3 overflow-hidden")}>
      {cols.map((lifecycle) => (
        <div
          key={lifecycle}
          className="w-[260px] min-w-[260px] rounded-[var(--radius-lg)] border border-[var(--border)] p-3"
        >
          <Skeleton className="h-3 w-16 mb-3" />
          <Skeleton className="h-16 w-full mb-2" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
