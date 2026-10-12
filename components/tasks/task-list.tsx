"use client";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { pruneSelection, rangeBetween } from "@/lib/domain/selection";
import {
  SNOOZE_KEYS,
  SNOOZE_LABELS,
  SNOOZE_PRESETS,
  type SnoozePreset,
  describeSnooze,
  presetForKey,
  resolveSnooze,
} from "@/lib/domain/snooze";
import { statusLabel } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { cn } from "@/lib/utils/cn";
import * as React from "react";
import { StatusIcon } from "./status-icon";
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
 *
 * Focus recovery: when the focused row leaves the list (completed, filed
 * elsewhere, deleted), focus would fall to <body> and the next j/k would be
 * swallowed. Instead it lands on the row that took its place, else the new
 * last row, else the list container (or the empty state) — but never when
 * focus has already moved into an overlay such as the detail sheet.
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
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const listRef = React.useRef<HTMLDivElement>(null);
  const rowRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const didInitialFocus = React.useRef(false);
  /** The row that last held focus (keyboard or click), for recovery. */
  const focusedRowRef = React.useRef<{ id: string; index: number } | null>(null);
  /** Set when the list emptied under focus; the empty state takes focus on mount. */
  const emptyFocusPending = React.useRef(false);

  const { ghosts, dismissGhost } = useCompletionGhosts(tasks);

  // Range selection (Shift+click). The anchor is the last plainly clicked
  // or keyboard-active row; selection only ever contains visible ids.
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = React.useRef<string | null>(null);
  const visibleIds = React.useMemo(() => tasks.map((t) => t.id), [tasks]);

  React.useEffect(() => {
    setSelectedIds((old) => {
      if (old.size === 0) return old;
      const pruned = pruneSelection(old, visibleIds);
      return pruned.size === old.size ? old : pruned;
    });
  }, [visibleIds]);

  const clearSelection = React.useCallback(() => {
    setSelectedIds((old) => (old.size === 0 ? old : new Set()));
  }, []);

  const selectRangeTo = (targetId: string) => {
    const anchor = anchorRef.current ?? tasks[activeIndex]?.id ?? null;
    const range = rangeBetween(visibleIds, anchor, targetId);
    if (range.length === 0) return;
    if (!anchorRef.current) anchorRef.current = anchor ?? targetId;
    setSelectedIds(new Set(range));
  };

  const openRow = (id: string) => {
    anchorRef.current = id;
    clearSelection();
    onOpen(id);
  };

  const { pendingSnooze, handleSnoozeKey } = useSnoozeKeys(() => tasks[activeIndex] ?? null);

  React.useEffect(() => {
    if (activeIndex >= tasks.length) setActiveIndex(tasks.length - 1);
  }, [tasks.length, activeIndex]);

  const focusRowAt = React.useCallback((index: number) => {
    rowRefs.current[index]?.focus({ preventScroll: true });
  }, []);

  // Layout effect so recovery happens in the same frame the row unmounts —
  // focus has already fallen to <body> by now, and nothing has painted yet.
  React.useLayoutEffect(() => {
    const focused = focusedRowRef.current;
    if (!focused || tasks.some((t) => t.id === focused.id)) return;
    focusedRowRef.current = null;

    const current = document.activeElement;
    const inList = !!current && (listRef.current?.contains(current) ?? false);
    // Focus moved somewhere real (e.g. the detail sheet): leave it alone.
    if (current && current !== document.body && !inList) return;

    if (tasks.length === 0) {
      setActiveIndex(-1);
      emptyFocusPending.current = true;
      listRef.current?.focus({ preventScroll: true });
      return;
    }
    const next = Math.min(focused.index, tasks.length - 1);
    setActiveIndex(next);
    focusRowAt(next);
  }, [tasks, focusRowAt]);

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
    if (e.key === "Escape" && selectedIds.size > 0) {
      e.preventDefault();
      clearSelection();
      return;
    }
    if (tasks.length === 0) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (handleSnoozeKey(e)) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(tasks.length - 1, Math.max(0, i + 1)));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = tasks[activeIndex];
      if (t) openRow(t.id);
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

  const isEmpty = rows.length === 0;

  // The listbox unmounts when the last ghost collapses; if the list emptied
  // under keyboard focus, hand focus to the empty state so Tab reaches its
  // capture CTA and nothing is lost to <body>.
  React.useLayoutEffect(() => {
    if (!isEmpty || !emptyFocusPending.current) return;
    emptyFocusPending.current = false;
    const current = document.activeElement;
    if (!current || current === document.body) listRef.current?.focus({ preventScroll: true });
  }, [isEmpty]);

  if (isEmpty && emptyState) {
    return (
      <div ref={listRef} tabIndex={-1} className="focus:outline-none">
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label="Tasks"
      aria-multiselectable
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) listRef.current?.focus();
      }}
      className="relative flex flex-col rounded-[var(--radius-lg)] focus:outline-none"
    >
      {selectedIds.size >= 2 ? <BulkBar ids={[...selectedIds]} onClear={clearSelection} /> : null}
      {pendingSnooze ? <SnoozeHint /> : null}
      {rows.map((row, i) => {
        const divider =
          i < rows.length - 1 ? <div className="ml-9 h-px bg-[var(--border)] opacity-60" /> : null;
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
                  onOpen={openRow}
                  uncompleteTo={row.restoreTo}
                />
                {divider}
              </div>
            </div>
          );
        }
        return (
          <div
            key={row.task.id}
            className="animate-fade-in"
            // Both events: Safari does not focus a clicked button, so a
            // pointer press on the complete circle must count as well.
            onFocus={() => {
              focusedRowRef.current = { id: row.task.id, index: row.navIndex };
            }}
            onPointerDown={() => {
              focusedRowRef.current = { id: row.task.id, index: row.navIndex };
            }}
          >
            <TaskRow
              ref={(el) => {
                rowRefs.current[row.navIndex] = el;
              }}
              task={row.task}
              labels={labels}
              active={row.navIndex === activeIndex}
              selected={selectedIds.has(row.task.id)}
              tabIndex={row.navIndex === activeIndex ? 0 : -1}
              onOpen={openRow}
              onRangeSelect={selectRangeTo}
            />
            {divider}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Calm bulk bar: appears only with two or more rows selected. One primary
 * action (Someday — the pile a noisy Inbox most often empties into) and a
 * way out. The moved tasks leave this view, and the selection with them.
 */
function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const moveTasksToLifecycle = useStore((s) => s.moveTasksToLifecycle);
  const target: Lifecycle = "someday";
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      data-testid="bulk-bar"
      className={cn(
        "sticky top-2 z-10 mb-2 flex items-center justify-between gap-3",
        "rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)]/95 backdrop-blur",
        "py-1.5 pl-4 pr-1.5 shadow-sm animate-fade-in",
      )}
    >
      <span className="text-[12.5px] text-[var(--fg-muted)]">
        <span className="text-num text-[var(--fg)]">{ids.length}</span> selected
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            const count = ids.length;
            moveTasksToLifecycle(ids, target);
            onClear();
            toast(`Moved ${count} to ${statusLabel(target)}`);
          }}
        >
          <StatusIcon status={target} size={12} />
          Move to {statusLabel(target)}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

/** Shown while `s` is pending so the follow-up keys are discoverable. */
function SnoozeHint() {
  return (
    <div
      role="status"
      data-testid="snooze-hint"
      className="mb-2 flex items-center gap-2 px-2.5 text-[12px] text-[var(--fg-muted)] animate-fade-in"
    >
      <span>Snooze until</span>
      {SNOOZE_PRESETS.map((preset) => (
        <span key={preset} className="inline-flex items-center gap-1">
          <Kbd>{SNOOZE_KEYS[preset]}</Kbd>
          {SNOOZE_LABELS[preset]}
        </span>
      ))}
      <span className="text-[var(--fg-subtle)]">· Esc to cancel</span>
    </div>
  );
}

const SNOOZE_SEQUENCE_MS = 2000;

/**
 * `s` then `t`/`w`: snooze the active row to tomorrow / next Monday without
 * opening it. Confirms with an undoable toast so a mis-key costs nothing.
 */
function useSnoozeKeys(getActiveTask: () => Task | null): {
  pendingSnooze: boolean;
  handleSnoozeKey: (e: React.KeyboardEvent) => boolean;
} {
  const [pending, setPending] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPending(false);
  }, []);

  React.useEffect(() => cancel, [cancel]);

  const handleSnoozeKey = (e: React.KeyboardEvent): boolean => {
    if (pending) {
      cancel();
      const preset = presetForKey(e.key);
      if (!preset) return e.key === "Escape";
      e.preventDefault();
      const task = getActiveTask();
      if (task) snoozeTask(task, preset);
      return true;
    }
    if (e.key !== "s" || !getActiveTask()) return false;
    e.preventDefault();
    setPending(true);
    timerRef.current = setTimeout(() => setPending(false), SNOOZE_SEQUENCE_MS);
    return true;
  };

  return { pendingSnooze: pending, handleSnoozeKey };
}

export function snoozeTask(task: Task, preset: SnoozePreset): void {
  const { updateTask } = useStore.getState();
  const previousDue = task.due;
  const due = resolveSnooze(preset);
  updateTask(task.id, { due }, { editedFields: ["due"] });
  toast(`Snoozed until ${describeSnooze(preset)}`, {
    action: {
      label: "Undo",
      run: () => updateTask(task.id, { due: previousDue }, { editedFields: ["due"] }),
    },
  });
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
