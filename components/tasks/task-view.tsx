"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS, BoardSkeleton, BoardView } from "./board-view";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";
import { useViewMode } from "./use-view-mode";
import { ViewToggle } from "./view-toggle";
import { WelcomeCard } from "./welcome-card";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Board mode is workspace-wide: the columns are the statuses, so the same
 * board renders on every task page and the header says so instead of
 * keeping the route's own title.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  aboveList,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** Rendered between the welcome card and the list, in list mode only. */
  aboveList?: React.ReactNode;
}) {
  const { openDetail, openCapture, serverReady, syncError } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const board = useViewMode() === "board";

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  // Local cache first; an empty cache waits for the first pull so a new
  // account never flashes "Inbox zero" before its starter tasks arrive.
  const ready = hydrated && (tasks.length > 0 || serverReady);

  const header = (
    <PageHeader
      eyebrow={board ? "Board" : eyebrow}
      title={board ? "Everything, by status" : title}
      description={
        board
          ? "Drag a card to another column to file it. Same order, words, and icons as the sidebar."
          : description
      }
      actions={
        <div className="flex items-center gap-2">
          {rightSlot}
          <ViewToggle />
        </div>
      }
    />
  );

  const onAdd = React.useCallback(
    (lifecycle: Task["lifecycle"]) => openCapture({ lifecycle }),
    [openCapture],
  );

  if (board) {
    return (
      <>
        {/* The header shares the board's breakout width so its text
            left-aligns with the first column, not the reading column. */}
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>{header}</div>
        {ready ? <WelcomeCard /> : null}
        {ready ? (
          <BoardView tasks={tasks} onOpen={openDetail} onAdd={onAdd} syncError={syncError} />
        ) : (
          <BoardSkeleton />
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {ready ? <WelcomeCard /> : null}
      {ready ? aboveList : null}
      {ready ? (
        <TaskList
          tasks={visible}
          onOpen={openDetail}
          emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
        />
      ) : (
        <TaskListSkeleton />
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
