"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type BoardConfig, PIPELINE_BOARD, selectBoardColumns } from "@/lib/store/board";
import { useStore } from "@/lib/store/store";
import { usePathname } from "next/navigation";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { ViewModeToggle } from "./view-mode-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * The same gate covers the List/Board choice, which is a persisted preference
 * and therefore unknowable on the server — without it, a board user would
 * watch a list paint and then swap.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  board = PIPELINE_BOARD,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** How this route lays out its board. Defaults to the full pipeline. */
  board?: BoardConfig;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);
  const emphasisStatus = useRouteStatus();

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  // Only paid for while the board is on screen.
  const isBoard = hydrated && viewMode === "board";
  const columns = React.useMemo(
    () => (isBoard ? board.partition(tasks) : []),
    [isBoard, board, tasks],
  );
  const droppedColumn = React.useMemo(
    () =>
      isBoard && board.offersDropped ? (selectBoardColumns(tasks, ["dropped"])[0] ?? null) : null,
    [isBoard, board, tasks],
  );

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            {rightSlot}
            <ViewModeToggle />
          </>
        }
      />
      {!hydrated ? (
        viewMode === "board" ? (
          <BoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : isBoard ? (
        <TaskBoard
          columns={columns}
          droppedColumn={droppedColumn}
          onOpen={openDetail}
          emphasisStatus={emphasisStatus}
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

/**
 * The status this route is "about", used to keep the current view legible once
 * the board replaces its list with the whole pipeline. Null on Today, which is
 * a lens rather than a status.
 */
function useRouteStatus(): Lifecycle | null {
  const pathname = usePathname();
  return React.useMemo(
    () => STATUS_VIEWS.find((v) => pathname?.startsWith(v.href))?.status ?? null,
    [pathname],
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
    <div className="-mx-4 overflow-hidden px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex items-start gap-2.5">
        {[0, 1, 2, 3, 4].map((col) => (
          <div key={col} className="flex w-[264px] shrink-0 flex-col gap-2 p-2">
            <Skeleton className="h-3.5 w-24" />
            <div className="flex flex-col gap-1.5">
              {[0, 1].map((card) => (
                <Skeleton key={card} className="h-[72px] rounded-[var(--radius-md)]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
