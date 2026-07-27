"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { useBoardMode } from "@/lib/store/view-mode";
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
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  selector: (tasks: Task[]) => Task[];
  emptyTitle: string;
  emptyDescription?: string;
  rightSlot?: React.ReactNode;
  enableBoard?: boolean;
}) {
  const { openDetail } = useFrame();
  const tasks = useStore((s) => s.tasks);
  const hydrated = useStore((s) => s.hydrated);
  const { mode, setMode } = useBoardMode();

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const showBoard = enableBoard && mode === "board";
  const actions = (
    <div className="flex items-center gap-2">
      {enableBoard ? <ViewToggle mode={mode} onChange={setMode} /> : null}
      {rightSlot}
    </div>
  );

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {!hydrated ? (
        showBoard ? (
          <BoardSkeleton />
        ) : (
          <TaskListSkeleton />
        )
      ) : showBoard ? (
        <BoardView tasks={visible} onOpen={openDetail} />
      ) : (
        <div className="max-w-[820px]">
          <TaskList
            tasks={visible}
            onOpen={openDetail}
            emptyState={<TaskEmptyState title={emptyTitle} description={emptyDescription} />}
          />
        </div>
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

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden pb-3">
      {[0, 1, 2, 3, 4].map((column) => (
        <div
          key={column}
          className="flex h-[calc(100dvh-220px)] min-h-[420px] w-[224px] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/70 p-2"
        >
          <div className="mb-2 flex h-8 items-center gap-2 px-1">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="ml-auto h-3 w-4" />
          </div>
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <Skeleton className="mb-2 h-3.5 w-[88%]" />
              <Skeleton className="mb-3 h-3 w-[68%]" />
              <div className="flex gap-1">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
