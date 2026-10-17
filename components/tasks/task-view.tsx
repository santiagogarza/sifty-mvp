"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { useClientReady, useViewMode } from "@/lib/store/view-mode";
import * as React from "react";
import { BoardSkeleton, BoardView } from "./board-view";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";
import { ViewToggle } from "./view-toggle";

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
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
}) {
  const { openDetail, openCapture, syncError } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const mode = useViewMode();
  const clientReady = useClientReady();
  const board = clientReady && mode === "board";

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  const header = (
    <PageHeader
      eyebrow={board ? "BOARD" : eyebrow}
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

  if (!hydrated || !clientReady) {
    return (
      <>
        {header}
        {board ? <BoardSkeleton /> : <TaskListSkeleton />}
      </>
    );
  }

  return (
    <>
      {header}
      {board ? (
        <BoardView
          tasks={tasks}
          onOpen={openDetail}
          onAdd={(lifecycle) => openCapture({ lifecycle })}
          syncError={syncError}
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
