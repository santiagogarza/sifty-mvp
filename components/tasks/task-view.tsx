"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import type { ViewMode } from "@/lib/store/view-mode";
import * as React from "react";
import { BoardView } from "./board/board-view";
import { ViewToggle } from "./board/view-toggle";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";

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
  enableBoard = false,
  mode = "list",
  onModeChange,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** Offer the List/Board toggle. Off for lens views like Today. */
  enableBoard?: boolean;
  mode?: ViewMode;
  onModeChange?: (mode: ViewMode) => void;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);

  const isBoard = enableBoard && mode === "board";
  const visible = React.useMemo(() => (isBoard ? [] : selector(tasks)), [tasks, selector, isBoard]);

  const actions =
    enableBoard && onModeChange ? (
      <>
        {rightSlot}
        <ViewToggle mode={mode} onChange={onModeChange} />
      </>
    ) : (
      rightSlot
    );

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {isBoard ? (
        <BoardView />
      ) : !hydrated ? (
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
