"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import { usePathname } from "next/navigation";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS, TaskBoard } from "./task-board";
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
  boardScope = "all",
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /**
   * `today` partitions Today-eligible tasks by their real lifecycle.
   * Every other route shows the whole pipeline; the columns are the filter.
   */
  boardScope?: "all" | "today";
}) {
  const { openDetail, openCapture } = useFrame();
  const pathname = usePathname() ?? "/";
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewModes[pathname] ?? "list");

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const board = hydrated && viewMode === "board";

  const header = (
    <PageHeader
      eyebrow={board ? "Board" : eyebrow}
      title={
        board ? (boardScope === "today" ? "Today, by status" : "Everything, by status") : title
      }
      description={
        board
          ? "Drag a card to another column to file it. Same order, words, and icons as the sidebar."
          : description
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
      {board ? (
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>{header}</div>
      ) : (
        header
      )}
      {!hydrated ? (
        <TaskListSkeleton />
      ) : board ? (
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>
          <TaskBoard
            lens={boardScope === "today" ? "today" : undefined}
            onOpen={openDetail}
            onCapture={(lifecycle) =>
              openCapture(lifecycle === "inbox" ? undefined : { fileTo: lifecycle })
            }
          />
        </div>
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
