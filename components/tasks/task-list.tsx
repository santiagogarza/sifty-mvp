"use client";

import type { Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { TaskRow } from "./task-row";

/**
 * Task list with arrow/j/k navigation. The listbox container is focusable so
 * shortcuts work from the page without tabbing into a row first. Scoped to
 * the surrounding container so multiple lists can coexist without fighting
 * over the active row.
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
  const listRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const didInitialFocus = React.useRef(false);

  React.useEffect(() => {
    if (activeIndex >= tasks.length) setActiveIndex(tasks.length - 1);
  }, [tasks.length, activeIndex]);

  React.useEffect(() => {
    if (tasks.length === 0 || didInitialFocus.current) return;
    didInitialFocus.current = true;
    listRef.current?.focus({ preventScroll: true });
  }, [tasks.length]);

  React.useEffect(() => {
    if (activeIndex < 0) return;
    rowRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (tasks.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(tasks.length - 1, Math.max(0, i + 1)));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = tasks[activeIndex];
      if (t) onOpen(t.id);
    }
  };

  if (tasks.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label="Tasks"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) listRef.current?.focus();
      }}
      className="flex flex-col rounded-[var(--radius-lg)] focus:outline-none"
    >
      {tasks.map((task, i) => (
        <div key={task.id} className="animate-fade-in">
          <TaskRow
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            task={task}
            labels={labels}
            active={i === activeIndex}
            tabIndex={i === activeIndex ? 0 : -1}
            onOpen={onOpen}
          />
          {i < tasks.length - 1 ? (
            <div className="ml-9 h-px bg-[var(--border)] opacity-60" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
