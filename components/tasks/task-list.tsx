"use client";

import { Kbd } from "@/components/ui/kbd";
import { type SnoozePreset, isSnoozed, snoozeDateFor } from "@/lib/domain/snooze";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import * as React from "react";
import type { SnoozeMenuMode } from "./snooze-menu";
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
 * it had before completion. Snoozing from a row ghosts the same way, showing
 * the wake day before the row collapses.
 *
 * Snooze chord: with a row focused, `s` then `t` / `w` / `n` snoozes to a
 * preset and `s` then `d` opens that row's date picker.
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

  const { ghosts, dismissGhost } = useCompletionGhosts(tasks);
  const snoozeTask = useStore((s) => s.snoozeTask);
  const [snoozeMenu, setSnoozeMenu] = React.useState<{
    id: string;
    mode: SnoozeMenuMode;
  } | null>(null);
  const [chordPending, setChordPending] = React.useState(false);
  const chordTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // A snoozed row unmounts while focused; hand focus to its neighbour so
  // j/k and the chord keep working without a click.
  const refocusAfterSnooze = React.useRef(false);

  const endChord = React.useCallback(() => {
    if (chordTimer.current) clearTimeout(chordTimer.current);
    chordTimer.current = null;
    setChordPending(false);
  }, []);

  const startChord = () => {
    if (chordTimer.current) clearTimeout(chordTimer.current);
    chordTimer.current = setTimeout(endChord, CHORD_TIMEOUT_MS);
    setChordPending(true);
  };

  React.useEffect(() => endChord, [endChord]);

  React.useEffect(() => {
    if (!refocusAfterSnooze.current) return;
    refocusAfterSnooze.current = false;
    const index = Math.min(activeIndex, tasks.length - 1);
    if (index >= 0) rowRefs.current[index]?.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
  }, [tasks, activeIndex]);

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
    const activeTask = tasks[activeIndex];
    if (chordPending) {
      if (MODIFIER_KEYS.has(e.key)) return;
      e.preventDefault();
      endChord();
      if (!activeTask) return;
      const key = e.key.toLowerCase();
      const preset = CHORD_PRESETS[key];
      if (preset) {
        refocusAfterSnooze.current = true;
        snoozeTask(activeTask.id, snoozeDateFor(preset));
      } else if (key === "d") {
        setSnoozeMenu({ id: activeTask.id, mode: "date" });
      }
      return;
    }
    if (
      e.key === "s" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      activeTask &&
      activeTask.lifecycle !== "done" &&
      activeTask.lifecycle !== "dropped" &&
      e.target === rowRefs.current[activeIndex]
    ) {
      e.preventDefault();
      startChord();
      return;
    }
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
      | { kind: "ghost"; task: Task; restoreTo: Lifecycle; reason: GhostReason }
    > = tasks.map((task, navIndex) => ({ kind: "task" as const, task, navIndex }));
    for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
      out.splice(Math.min(g.index, out.length), 0, {
        kind: "ghost",
        task: g.task,
        restoreTo: g.restoreTo,
        reason: g.reason,
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
                data-reason={row.reason}
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
                    ghost={row.reason}
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
                snoozeMenu={snoozeMenu?.id === row.task.id ? snoozeMenu.mode : null}
                onSnoozeMenuChange={(mode) =>
                  setSnoozeMenu(mode ? { id: row.task.id, mode } : null)
                }
                onSnoozed={() => {
                  refocusAfterSnooze.current = true;
                }}
              />
              {divider}
            </div>
          );
        })}
      </div>
      {chordPending ? <SnoozeChordHint /> : null}
    </>
  );
}

const CHORD_TIMEOUT_MS = 3000;

const CHORD_PRESETS: Record<string, SnoozePreset> = {
  t: "tomorrow",
  w: "weekend",
  n: "next_week",
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

function SnoozeChordHint() {
  return (
    <div
      role="status"
      className="fixed bottom-[92px] md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)]/95 px-3.5 py-1.5 text-[12px] text-[var(--fg-muted)] shadow-sm backdrop-blur animate-rise"
    >
      <span className="text-[var(--fg)]">Snooze</span>
      <span className="flex items-center gap-1">
        <Kbd>T</Kbd> tomorrow
      </span>
      <span className="flex items-center gap-1">
        <Kbd>W</Kbd> weekend
      </span>
      <span className="flex items-center gap-1">
        <Kbd>N</Kbd> next week
      </span>
      <span className="flex items-center gap-1">
        <Kbd>D</Kbd> date…
      </span>
    </div>
  );
}

type GhostReason = "done" | "snoozed";

interface CompletionGhost {
  /** The live version of the task: checked, or showing its wake day. */
  task: Task;
  reason: GhostReason;
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

    // A ghost is a task that just left this list because it was completed
    // or snoozed: gone from the visible set, but still in the store.
    const currentIds = new Set(tasks.map((t) => t.id));
    const store = useStore.getState();
    const additions: CompletionGhost[] = [];
    prev.forEach((before, index) => {
      if (currentIds.has(before.id)) return;
      const after = store.tasks.find((t) => t.id === before.id);
      if (!after) return;
      const reason = ghostReason(before, after);
      if (!reason) return;
      additions.push({ task: after, index, reason, restoreTo: before.lifecycle });
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

  // Structural invariant: an entry whose task is gone or no longer matches
  // its reason (done / snoozed) is deleted, not merely hidden — otherwise a hidden entry could outlive a
  // later re-completion and resurrect with a stale restoreTo/index.
  React.useEffect(() => {
    if (ghosts.size === 0) return;
    const liveById = new Map(allTasks.map((t) => [t.id, t]));
    for (const id of ghosts.keys()) {
      const live = liveById.get(id);
      const ghost = ghosts.get(id);
      if (!live || !ghost || !stillGhosted(ghost.reason, live)) dismissGhost(id);
    }
  }, [ghosts, allTasks, dismissGhost]);

  // Consumption-point filter (same-render defense in depth): a ghost renders
  // only while its task still matches its reason in the store and hasn't re-entered
  // this list, and always renders the live task — never a stale snapshot.
  const visibleGhosts = React.useMemo(() => {
    const currentIds = new Set(tasks.map((t) => t.id));
    const liveById = new Map(allTasks.map((t) => [t.id, t]));
    return [...ghosts.values()].flatMap((g) => {
      if (currentIds.has(g.task.id)) return [];
      const live = liveById.get(g.task.id);
      if (!live || !stillGhosted(g.reason, live)) return [];
      return [{ ...g, task: live }];
    });
  }, [ghosts, tasks, allTasks]);

  return { ghosts: visibleGhosts, dismissGhost };
}

function isOpenTask(t: Task): boolean {
  return t.lifecycle !== "done" && t.lifecycle !== "dropped";
}

function ghostReason(before: Task, after: Task): GhostReason | null {
  if (before.lifecycle !== "done" && after.lifecycle === "done") return "done";
  if (!isSnoozed(before) && isSnoozed(after) && isOpenTask(after)) return "snoozed";
  return null;
}

function stillGhosted(reason: GhostReason, live: Task): boolean {
  return reason === "done" ? live.lifecycle === "done" : isOpenTask(live) && isSnoozed(live);
}
