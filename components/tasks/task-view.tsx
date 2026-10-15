"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { BoardView } from "./board-view";
import { TaskEmptyState } from "./empty-state";
import { TaskList } from "./task-list";
import { useViewMode } from "./use-view-mode";
import { ViewToggle } from "./view-toggle";

/**
 * Reusable view that renders the standard structure for Today/Inbox/Focus/etc.
 * Hydration-safe: renders skeletons until the persistence rehydrates so the
 * server-rendered shell never shows a flashed empty state.
 *
 * Board mode ignores the route's selector: every route shows the same full
 * pipeline, which is why the List/Board choice is one global preference.
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

  const visible = React.useMemo(() => selector(tasks), [tasks, selector]);
  const onAdd = React.useCallback(
    (lifecycle: Task["lifecycle"]) => openCapture({ lifecycle }),
    [openCapture],
  );

  const actions = (
    <>
      {rightSlot}
      <ViewToggle mode={mode} onChange={setMode} />
    </>
  );

  if (mode === "board") {
    return (
      // Widen from the 820px reading column to the full pane (see the
      // @container on <main>); header and board share one left edge.
      <div className="w-[100cqw] ml-[calc(50%-50cqw)] px-4 sm:px-6 md:px-8">
        <div className="mx-auto max-w-[1360px]">
          <PageHeader
            eyebrow="Board"
            title="Everything, by status"
            description="Drag a card to another column to file it. Same order, words, and icons as the sidebar."
            actions={actions}
          />
          {!hydrated ? (
            <BoardSkeleton />
          ) : (
            <BoardView tasks={tasks} onOpen={openDetail} onAdd={onAdd} syncError={syncError} />
          )}
        </div>
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

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex w-[288px] shrink-0 flex-col gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)] p-1.5 md:w-auto md:min-w-[184px] md:flex-1"
        >
          <Skeleton className="mx-1.5 my-1.5 h-3.5 w-[45%]" />
          <Skeleton className="h-[64px] rounded-[var(--radius-md)]" />
          <Skeleton className="h-[64px] rounded-[var(--radius-md)]" />
        </div>
      ))}
    </div>
  );
}
