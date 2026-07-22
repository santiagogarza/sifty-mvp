"use client";

import { useFrame } from "@/components/app-shell/app-frame";
import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/lib/store/store";
import { List } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { TaskBoard } from "./task-board";

export function TaskBoardView() {
  const { openDetail } = useFrame();
  const tasks = useStore((state) => state.tasks);
  const hydrated = useStore((state) => state.hydrated);

  const boardTasks = React.useMemo(
    () => tasks.filter((task) => task.lifecycle !== "dropped"),
    [tasks],
  );

  return (
    <>
      <PageHeader
        eyebrow="Board"
        title="Task board"
        description="Move work from left to right as its status changes."
        actions={<ListLink />}
      />
      {!hydrated ? <TaskBoardSkeleton /> : <TaskBoard tasks={boardTasks} onOpen={openDetail} />}
    </>
  );
}

function ListLink() {
  return (
    <Link
      href="/today"
      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] text-[var(--fg-muted)] transition-colors duration-150 ease-[var(--ease-product)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]"
      aria-label="Open list view"
    >
      <List size={13} />
      <span>List</span>
    </Link>
  );
}

function TaskBoardSkeleton() {
  return (
    <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-3 overflow-x-auto pb-2">
      {[0, 1, 2, 3, 4].map((column) => (
        <div
          key={column}
          className="min-h-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]/55 p-2.5"
        >
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="size-4 rounded-full" />
          </div>
          {[0, 1, 2].map((card) => (
            <div
              key={card}
              className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <Skeleton className="mb-2 h-3.5 w-[75%]" />
              <Skeleton className="mb-3 h-3 w-[55%]" />
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-12 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
