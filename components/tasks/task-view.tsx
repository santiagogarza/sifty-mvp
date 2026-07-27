"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useBoardMode } from "@/lib/store/view-mode";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { BoardView, BoardViewSkeleton } from "./board/board-view";
import { ViewToggle } from "./board/view-toggle";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * On status routes, a List/Board toggle lands in the header actions. Board
 * mode releases the status filter and shows all five STATUS_VIEWS columns.
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
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  /** When true, show the List/Board toggle and render BoardView in board mode. */
  enableBoard?: boolean;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const { mode, setMode, isBoard } = useBoardMode();

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);

  const actions = (
    <div className="flex items-center gap-2">
      {rightSlot}
      {enableBoard ? <ViewToggle mode={mode} onChange={setMode} /> : null}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={enableBoard || rightSlot ? actions : undefined}
      />
      {!hydrated ? (
        isBoard && enableBoard ? <BoardViewSkeleton /> : <TaskListSkeleton />
      ) : enableBoard && isBoard ? (
        <BoardView onOpen={openDetail} />
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
