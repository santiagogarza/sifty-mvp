"use client";

import { Button } from "@/components/ui/button";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { rangeSelection } from "@/lib/utils/selection";
import * as React from "react";
import { TaskRow } from "./task-row";

/**
 * Task list with arrow/j/k navigation. The listbox container is focusable so
 * shortcuts work from the page without tabbing into a row first. Scoped to
 * the surrounding container so multiple lists can coexist without fighting
 * over the active row.
 *
 * Multi-selection (SIF-22): plain click selects a single row (the anchor);
 * Shift+click selects the contiguous range from the anchor through the
 * clicked row in visible order. With 2+ rows selected a bulk bar offers
 * "Move to Someday". Escape clears. Selection lives here — per view — and
 * is pruned whenever tasks leave the visible list, so no stale ids linger.
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
  autoFocus = true,
}: {
  tasks: Task[];
  emptyState?: React.ReactNode;
  onOpen: (id: string) => void;
  /**
   * Focus the listbox once tasks exist so j/k work immediately. On by
   * default for page-level lists; turn off for embedded lists (e.g. the
   * Dropped disclosure) where stealing focus would yank the user around.
   */
  autoFocus?: boolean;
}) {
  const labels = useStore((s) => s.labels);
  const moveTasksToLifecycle = useStore((s) => s.moveTasksToLifecycle);
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const listRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const didInitialFocus = React.useRef(false);

  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  // Anchor = last plain-clicked row. Only read at click time, so a ref
  // avoids re-rendering the list on every anchor change.
  const anchorRef = React.useRef<string | null>(null);

  const { ghosts, dismissGhost } = useCompletionGhosts(tasks);

  const visibleIds = React.useMemo(() => tasks.map((t) => t.id), [tasks]);

  // Prune selection when tasks leave the view (completed, moved, filtered):
  // ids must never outlive their row or a later bulk move would touch
  // tasks the user can no longer see.
  React.useEffect(() => {
    if (anchorRef.current && !visibleIds.includes(anchorRef.current)) {
      anchorRef.current = null;
    }
    setSelectedIds((old) => {
      if (old.size === 0) return old;
      const visible = new Set(visibleIds);
      const next = new Set([...old].filter((id) => visible.has(id)));
      return next.size === old.size ? old : next;
    });
  }, [visibleIds]);

  const clearSelection = React.useCallback(() => {
    anchorRef.current = null;
    setSelectedIds((old) => (old.size === 0 ? old : new Set()));
  }, []);

  const handleSelect = React.useCallback(
    (id: string, { shift }: { shift: boolean }) => {
      if (shift) {
        setSelectedIds(new Set(rangeSelection(visibleIds, anchorRef.current, id)));
        // Shift+click with no anchor selects just the row; it also becomes
        // the anchor so the next Shift+click ranges from it.
        anchorRef.current ??= id;
      } else {
        anchorRef.current = id;
        setSelectedIds(new Set([id]));
      }
    },
    [visibleIds],
  );

  const moveSelectedToSomeday = () => {
    moveTasksToLifecycle([...selectedIds], "someday");
    clearSelection();
  };

  React.useEffect(() => {
    if (activeIndex >= tasks.length) setActiveIndex(tasks.length - 1);
  }, [tasks.length, activeIndex]);

  React.useEffect(() => {
    if (!autoFocus || tasks.length === 0 || didInitialFocus.current) return;
    didInitialFocus.current = true;
    listRef.current?.focus({ preventScroll: true });
  }, [tasks.length, autoFocus]);

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
    } else if (e.key === "Escape" && selectedIds.size > 0) {
      // Only claim Escape while a selection exists, so it keeps doing
      // whatever it does elsewhere (e.g. closing the detail sheet).
      e.preventDefault();
      clearSelection();
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
    <>
      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable="true"
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
            i < rows.length - 1 ? (
              <div className="ml-9 h-px bg-[var(--border)] opacity-60" />
            ) : null;
          if (row.kind === "ghost") {
            return (
              <div
                key={`ghost-${row.task.id}`}
                className="ghost-collapse"
                onAnimationEnd={(e) => {
                  // Unmount exactly when the collapse finishes, so the CSS
                  // timing is the single source of truth.
                  if (e.animationName === "sifty-ghost-collapse") dismissGhost(row.task.id);
                }}
              >
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
                selected={selectedIds.has(row.task.id)}
                onSelect={handleSelect}
              />
              {divider}
            </div>
          );
        })}
      </div>
      {selectedIds.size >= 2 ? (
        <BulkBar
          count={selectedIds.size}
          onMoveToSomeday={moveSelectedToSomeday}
          onClear={clearSelection}
        />
      ) : null}
    </>
  );
}

/**
 * Calm bulk-action bar: floats bottom-center only while 2+ rows are
 * selected, one primary action, everything on the existing surface scale.
 */
function BulkBar({
  count,
  onMoveToSomeday,
  onClear,
}: {
  count: number;
  onMoveToSomeday: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 animate-fade-in"
    >
      <div
        className={[
          "flex items-center gap-2 rounded-[var(--radius-lg)]",
          "border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-4 pr-1.5",
          "shadow-[0_8px_24px_oklch(0%_0_0/0.12),0_1px_2px_oklch(0%_0_0/0.08)]",
        ].join(" ")}
      >
        <span aria-live="polite" className="text-[13px] tabular-nums text-[var(--fg-muted)] mr-1">
          {count} selected
        </span>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Button size="sm" variant="primary" onClick={onMoveToSomeday}>
          Move to {statusLabel("someday")}
        </Button>
      </div>
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

/**
 * Safety net only: ghosts normally unmount on the collapse animation's end
 * event, so the CSS owns the timing. This just guards environments where
 * the animation never runs.
 */
const GHOST_SAFETY_MS = 4000;

function useCompletionGhosts(tasks: Task[]): {
  ghosts: CompletionGhost[];
  dismissGhost: (id: string) => void;
} {
  const allTasks = useStore((s) => s.tasks);
  const [ghosts, setGhosts] = React.useState<ReadonlyMap<string, CompletionGhost>>(new Map());
  const prevRef = React.useRef(tasks);
  const timersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissGhost = React.useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setGhosts((old) => {
      if (!old.has(id)) return old;
      const next = new Map(old);
      next.delete(id);
      return next;
    });
  }, []);

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
        }, GHOST_SAFETY_MS),
      );
    }
  }, [tasks]);

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  // Structural invariant: an entry whose task is gone or no longer done is
  // deleted, not merely hidden — otherwise a hidden entry could outlive a
  // later re-completion and resurrect with a stale restoreTo/index.
  React.useEffect(() => {
    if (ghosts.size === 0) return;
    const liveById = new Map(allTasks.map((t) => [t.id, t]));
    for (const id of ghosts.keys()) {
      const live = liveById.get(id);
      if (!live || live.lifecycle !== "done") dismissGhost(id);
    }
  }, [ghosts, allTasks, dismissGhost]);

  // Consumption-point filter (same-render defense in depth): a ghost renders
  // only while its task is still done in the store and hasn't re-entered
  // this list, and always renders the live task — never a stale snapshot.
  const visibleGhosts = React.useMemo(() => {
    const currentIds = new Set(tasks.map((t) => t.id));
    const liveById = new Map(allTasks.map((t) => [t.id, t]));
    return [...ghosts.values()].flatMap((g) => {
      if (currentIds.has(g.task.id)) return [];
      const live = liveById.get(g.task.id);
      if (!live || live.lifecycle !== "done") return [];
      return [{ ...g, task: live }];
    });
  }, [ghosts, tasks, allTasks]);

  return { ghosts: visibleGhosts, dismissGhost };
}
