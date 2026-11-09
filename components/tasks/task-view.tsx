"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { useViewMode } from "@/lib/store/view-mode";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard, TaskBoardSkeleton } from "./task-board";
import { TaskList } from "./task-list";
import { ViewToggle } from "./view-toggle";

/**
 * Board mode breaks out of the 820px reading column to span the main pane
 * (`100cqw` against the `@container` on <main>), capped on very wide
 * screens, and fills the viewport under the 56px top bar (and above the
 * 80px mobile bottom nav) so each column scrolls on its own.
 */
const BOARD_FRAME = cn(
  "flex flex-col w-[min(100cqw,1440px)] ml-[calc(50%_-_min(50cqw,720px))]",
  "h-[calc(100dvh_-_136px)] md:h-[calc(100dvh_-_56px)] min-h-[480px] pb-4 md:pb-6",
);
const PAGE_GUTTER = "px-4 sm:px-6 md:px-8";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Board mode lays out the whole pipeline by status on every task page — a
 * board of one status would be a worse list — so the header says so
 * instead of keeping the page's own title.
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
  const { openDetail, captureInto, syncNoticeVisible } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const [viewMode] = useViewMode();

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  const actions = (
    <>
      {rightSlot}
      <ViewToggle />
    </>
  );

  if (viewMode === "board") {
    // Empty is silence: nothing to drag, so no instructions either.
    const anyOnBoard = tasks.some((t) => t.lifecycle !== "dropped");
    return (
      <div className={BOARD_FRAME}>
        <div className={PAGE_GUTTER}>
          <PageHeader
            eyebrow="Board"
            title="Everything, by status"
            description={
              hydrated && anyOnBoard
                ? "Drag a card to another column to change its status."
                : undefined
            }
            actions={actions}
          />
        </div>
        {hydrated ? (
          <TaskBoard onOpen={openDetail} onAdd={captureInto} liftToast={syncNoticeVisible} />
        ) : (
          <TaskBoardSkeleton />
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {!hydrated ? (
        <TaskListSkeleton />
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
