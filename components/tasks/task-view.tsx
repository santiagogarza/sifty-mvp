"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
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
  isTodayBoard,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  isTodayBoard?: boolean;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const viewMode = useStore((s) => s.viewMode);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  return (
    <div className="flex flex-col h-full">
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
      {!hydrated ? (
        viewMode === "board" ? (
          <TaskBoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : viewMode === "board" ? (
        <TaskBoard tasks={tasks} onOpen={openDetail} isTodayBoard={isTodayBoard} />
      ) : (
        <TaskList
          tasks={visible}
          onOpen={openDetail}
          emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
        />
      )}
    </div>
  );
}

function TaskBoardSkeleton() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="flex h-full gap-4 px-4 pb-4">
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="flex flex-col w-[320px] shrink-0 gap-3">
            <div className="flex items-center gap-2 px-1 py-2">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
            {[0, 1, 2].map((card) => (
              <div
                key={card}
                className="rounded-[var(--radius-md)] border bg-[var(--surface)] p-3 flex flex-col gap-2"
              >
                <div className="flex items-start gap-2">
                  <Skeleton className="size-5 rounded-full shrink-0" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-[80%]" />
                    <Skeleton className="h-3 w-[60%]" />
                  </div>
                </div>
              </div>
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
