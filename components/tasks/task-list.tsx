"use client";

import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import { TaskRow } from "./task-row";

/**
 * Task list with arrow/j/k navigation. The listbox container is focusable so
 * shortcuts work from the page without tabbing into a row first. Scoped to
 * the surrounding container so multiple lists can coexist without fighting
 * over the active row.
 *
 * Completion ghosts: checking a task off filters it out of most views
 * instantly, which reads as deletion. A just-completed task therefore stays
 * rendered in place — checked, struck through — for a beat before it
 * collapses out, and unchecking it within that window restores the status
 * it had before completion.
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

  const ghosts = useCompletionGhosts(tasks);

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

  // Ghosts splice back into the spot the task occupied before completion.
  // Keyboard navigation stays on the real (non-ghost) tasks.
  const rows = React.useMemo(() => {
    const out: Array<
      | { kind: "task"; task: Task; navIndex: number }
      | { kind: "ghost"; task: Task; restoreTo: Lifecycle }
    > = tasks.map((task, navIndex) => ({ kind: "task" as const, task, navIndex }));
    for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
      out.splice(Math.min(g.index, out.length), 0, {
        kind: "ghost",
        task: g.task,
        restoreTo: g.restoreTo,
      });
    }
    return out;
  }, [tasks, ghosts]);

  if (rows.length === 0 && emptyState) {
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
      {rows.map((row, i) => {
        const divider =
          i < rows.length - 1 ? <div className="ml-9 h-px bg-[var(--border)] opacity-60" /> : null;
        if (row.kind === "ghost") {
          return (
            <div key={`ghost-${row.task.id}`} className="ghost-collapse">
              <div>
                <TaskRow
                  task={row.task}
                  labels={labels}
                  onOpen={onOpen}
                  uncompleteTo={row.restoreTo}
                />
                {divider}
              </div>
            </div>
          );
        }
        return (
          <div key={row.task.id} className="animate-fade-in">
            <TaskRow
              ref={(el) => {
                rowRefs.current[row.navIndex] = el;
              }}
              task={row.task}
              labels={labels}
              active={row.navIndex === activeIndex}
              tabIndex={row.navIndex === activeIndex ? 0 : -1}
              onOpen={onOpen}
            />
            {divider}
          </div>
        );
      })}
    </div>
  );
}

interface CompletionGhost {
  /** The completed version of the task, rendered checked. */
  task: Task;
  /** Position the task held in the visible list before completion. */
  index: number;
  /** Status the task had before completion; unchecking restores it. */
  restoreTo: Lifecycle;
}

/** Visible pause before the collapse animation (see .ghost-collapse). */
const GHOST_TOTAL_MS = 880;

function useCompletionGhosts(tasks: Task[]): CompletionGhost[] {
  const [ghosts, setGhosts] = React.useState<ReadonlyMap<string, CompletionGhost>>(new Map());
  const prevRef = React.useRef(tasks);
  const timersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Layout effect: the ghost must mount in the same paint as the task's
  // removal, otherwise the row visibly blinks out before lingering.
  React.useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = tasks;
    if (prev === tasks) return;

    // A ghost is a task that just left this list because it was completed:
    // gone from the visible set, but still in the store with status done.
    const currentIds = new Set(tasks.map((t) => t.id));
    const store = useStore.getState();
    const additions: CompletionGhost[] = [];
    prev.forEach((before, index) => {
      if (currentIds.has(before.id) || before.lifecycle === "done") return;
      const now = store.tasks.find((t) => t.id === before.id);
      if (!now || now.lifecycle !== "done") return;
      additions.push({ task: now, index, restoreTo: before.lifecycle });
    });
    if (additions.length === 0) return;

    setGhosts((old) => {
      const next = new Map(old);
      for (const g of additions) next.set(g.task.id, g);
      return next;
    });
    for (const g of additions) {
      const id = g.task.id;
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id);
          setGhosts((old) => {
            if (!old.has(id)) return old;
            const next = new Map(old);
            next.delete(id);
            return next;
          });
        }, GHOST_TOTAL_MS),
      );
    }
  }, [tasks]);

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  // A ghost whose task reappeared in the list (unchecked in time) is done.
  return React.useMemo(() => {
    const currentIds = new Set(tasks.map((t) => t.id));
    return [...ghosts.values()].filter((g) => !currentIds.has(g.task.id));
  }, [ghosts, tasks]);
}
