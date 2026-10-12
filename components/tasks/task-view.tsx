"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
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
 * Board mode is workspace-wide: the columns are the lifecycle stages, so the
 * same board renders on every task page (the tabs already are the statuses).
 * The header swaps to a generic "Board" title to keep that honest.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  const board = hydrated && viewMode === "board";

  const header = (
    <PageHeader
      eyebrow={eyebrow}
      title={board ? "Board" : title}
      description={
        board ? "Everything on the board, by status. Drag a card to move it." : description
      }
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
      {/* In board mode the header shares the board's breakout width so its
          text left-aligns with the first column instead of the centered
          reading column. */}
      {board ? (
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>{header}</div>
      ) : (
        header
      )}
      {!hydrated ? (
        <TaskListSkeleton />
      ) : board ? (
        <TaskBoard
          onOpen={openDetail}
          emptyState={
            <TaskEmptyState
              title="Nothing on the board yet."
              description="Capture a task and it will land in the Inbox column."
            />
          }
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
