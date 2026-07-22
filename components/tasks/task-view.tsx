"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { usePathname } from "next/navigation";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard, boardHighlightForPath } from "./task-board";
import { TaskList } from "./task-list";
import { ViewModeToggle } from "./view-mode-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Supports a subtle list/board switch. Board mode shows the full lifecycle
 * pipeline so dragging cards between columns can change status.
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
  const viewMode = useStore((s) => s.tasksViewMode);
  const pathname = usePathname();

  const listTasks = React.useMemo(() => selector(tasks), [tasks, selector]);
  const boardTasks = React.useMemo(() => tasks.filter((t) => t.lifecycle !== "dropped"), [tasks]);
  const highlightColumn = boardHighlightForPath(pathname);

  const actions = (
    <div className="flex items-center gap-2">
      {rightSlot}
      <ViewModeToggle />
    </div>
  );

  // Wait for persistence before choosing list vs board so a stored board
  // preference never flashes the list chrome first.
  if (!hydrated) {
    return (
      <>
        <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
        <TaskListSkeleton />
      </>
    );
  }

  if (viewMode === "board") {
    return (
      <>
        <PageHeader
          eyebrow={eyebrow}
          title="Board"
          description="Drag cards across columns to change status. Arrow keys move a focused card left or right."
          actions={actions}
        />
        {boardTasks.length === 0 ? (
          <TaskEmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <TaskBoard tasks={boardTasks} onOpen={openDetail} highlightColumn={highlightColumn} />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      <TaskList
        tasks={listTasks}
        onOpen={openDetail}
        emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
      />
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
