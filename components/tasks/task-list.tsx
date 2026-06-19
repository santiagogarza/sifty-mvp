"use client";

import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { TaskRow } from "./task-row";

/**
 * Task list with arrow-key navigation. Scoped to the surrounding container
 * so multiple lists can coexist on the same page without fighting over
 * the active row.
 */
export function TaskList({
  tasks,
  emptyState,
  onOpen,
}: {
  tasks: Task[];
  emptyState?: React.ReactNode;
  onOpen: (id: string) => void;
}) {
  const labels = useStore((s) => s.labels);
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (activeIndex >= tasks.length) setActiveIndex(tasks.length - 1);
  }, [tasks.length, activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (tasks.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(tasks.length - 1, Math.max(0, i + 1)));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const t = tasks[activeIndex];
      if (t) onOpen(t.id);
    }
  };

  if (tasks.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div
      ref={ref}
      role="list"
      onKeyDown={onKeyDown}
      className="flex flex-col rounded-[var(--radius-lg)] focus:outline-none"
    >
      {tasks.map((task, i) => (
        <div role="listitem" key={task.id} className="animate-fade-in">
          <TaskRow task={task} labels={labels} active={i === activeIndex} onOpen={onOpen} />
          {i < tasks.length - 1 ? (
            <div className="ml-9 h-px bg-[var(--border)] opacity-60" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
