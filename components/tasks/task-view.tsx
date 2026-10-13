"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Task } from "@/lib/domain/types";
import { type BoardLens, DEFAULT_BOARD_LENS } from "@/lib/store/board";
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
 * server-rendered shell never shows a flashed empty state — and, since
 * `viewMode` is persisted client-side too, the board is gated on the same
 * flag with a board-shaped skeleton so first paint never flashes a list.
 *
 * Board mode drops the route's lifecycle filter and renders the pipeline as
 * columns (the columns *are* the statuses); the route still means something
 * because its own column is emphasized and scrolled into view. Today is the
 * exception: it keeps its lens and passes a restricted `BoardLens`.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  boardLens = DEFAULT_BOARD_LENS,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  boardLens?: BoardLens;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);
  const pathname = usePathname();

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  // The route's own column, when the route is a status view (/inbox → inbox,
  // /focus → active, …). Today isn't one — its board has no single column.
  const focusLifecycle = React.useMemo(
    () => STATUS_VIEWS.find((v) => v.href === pathname)?.status ?? null,
    [pathname],
  );

  const board = viewMode === "board";

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
      {/* In board mode the header shares the board's breakout width so its
          text left-aligns with the first column instead of the centered
          reading column. */}
      {board ? (
        <div className={cn(BOARD_BREAKOUT_CLASS, BOARD_GUTTER_CLASS)}>{header}</div>
      ) : (
        header
      )}
      {!hydrated ? (
        board ? (
          <TaskBoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : board ? (
        <TaskBoard onOpen={openDetail} lens={boardLens} focusLifecycle={focusLifecycle} />
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

function TaskBoardSkeleton() {
  return (
    <div className={BOARD_BREAKOUT_CLASS}>
      <div className={cn("flex gap-3 overflow-x-hidden pb-10", BOARD_GUTTER_CLASS)}>
        {[3, 2, 3, 2, 3].map((cards, column) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton slots — the list never reorders.
            key={column}
            className="flex w-[248px] min-w-[248px] flex-1 flex-col gap-1.5 self-start rounded-[var(--radius-lg)] bg-[var(--bg-sunken)]/60 p-1.5"
          >
            <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-2">
              <Skeleton className="size-3.5 rounded" />
              <Skeleton className="h-3 w-16" />
            </div>
            {[0, 1, 2].slice(0, cards).map((card) => (
              <Skeleton key={card} className="h-[52px] rounded-[var(--radius-md)]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
