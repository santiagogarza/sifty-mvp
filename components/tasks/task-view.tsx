"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useTaskLayout } from "@/lib/hooks/use-task-layout";
import { selectBoardTasks } from "@/lib/store/selectors";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { TaskEmptyState } from "./empty-state";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { ViewSwitcher } from "./view-switcher";

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
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const [layout, setLayout] = useTaskLayout();

  const listTasks = React.useMemo(() => selector(tasks), [tasks, selector]);
  const boardTasks = React.useMemo(() => selectBoardTasks(tasks), [tasks]);
  const visible = layout === "board" ? boardTasks : listTasks;

  const headerActions = (
    <>
      <ViewSwitcher layout={layout} onLayoutChange={setLayout} />
      {rightSlot}
    </>
  );

  const emptyState = (
    <TaskEmptyState
      title={layout === "board" ? "No tasks on the board." : emptyTitle}
      description={
        layout === "board"
          ? "Capture something new, or switch back to list view to see this page's filtered tasks."
          : emptyDescription
      }
    />
  );

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={headerActions}
      />
      {!hydrated ? (
        layout === "board" ? (
          <TaskBoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : layout === "board" ? (
        <TaskBoard tasks={visible} onOpen={openDetail} emptyState={emptyState} />
      ) : (
        <TaskList tasks={visible} onOpen={openDetail} emptyState={emptyState} />
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
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="w-[260px] shrink-0">
          <Skeleton className="h-4 w-20 mb-3" />
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--surface-muted)]/50 p-2">
            <Skeleton className="h-[72px] w-full rounded-[var(--radius-md)]" />
            <Skeleton className="h-[72px] w-full rounded-[var(--radius-md)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
