"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { BOARD_DESCRIPTION, BOARD_TITLE, BoardSkeleton, BoardView } from "./board-view";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";
import { useViewMode } from "./use-view-mode";
import { ViewToggle } from "./view-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Owns the List / Board toggle. Board releases the route's selector and
 * shows every status as a column, so its header is the board's own; List
 * restores the route's selector and copy.
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
  const [mode, setMode] = useViewMode();
  const board = mode === "board";

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const onAdd = React.useCallback(
    (lifecycle: Lifecycle) => openCapture({ lifecycle }),
    [openCapture],
  );

  return (
    <>
      <PageHeader
        eyebrow={board ? "Board" : eyebrow}
        title={board ? BOARD_TITLE : title}
        description={board ? BOARD_DESCRIPTION : description}
        actions={
          <>
            {rightSlot}
            <ViewToggle value={mode} onChange={setMode} />
          </>
        }
      />
      {!hydrated ? (
        board ? (
          <BoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : board ? (
        <BoardView tasks={tasks} onOpen={openDetail} onAdd={onAdd} stackAboveNotice={syncError} />
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
