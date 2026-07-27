"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import type { BoardModeApi } from "@/lib/store/view-mode";
import * as React from "react";
import { BoardView } from "./board/board-view";
import { ViewToggle } from "./board/view-toggle";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Board mode replaces the list with the whole pipeline rather than this
 * view's one status, so the header restates the scope instead of leaving
 * the page claiming to be "Focus" with five columns on screen.
 */
export function TaskView({
  eyebrow,
  title,
  description,
  selector,
  emptyTitle,
  emptyDescription,
  rightSlot,
  view,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** Omit to render a list-only view with no toggle. */
  view?: BoardModeApi;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const board = view?.mode === "board";
  // An empty board says nothing at all — not even how to drag, since
  // there is nothing to drag. Capture is still one keystroke away.
  const boardHasTasks = board && hydrated && tasks.length > 0;

  const actions = view ? (
    <>
      {rightSlot}
      <ViewToggle mode={view.mode} onChange={view.setMode} />
    </>
  ) : (
    rightSlot
  );

  return (
    <>
      <PageHeader
        eyebrow={board ? "Board" : eyebrow}
        title={board ? "Everything, by status" : title}
        description={
          board
            ? boardHasTasks
              ? "Drag a card to another column to file it. Same order, words, and icons as the sidebar."
              : undefined
            : description
        }
        actions={actions}
      />
      {board ? (
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
