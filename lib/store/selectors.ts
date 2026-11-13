"use client";

import { focusScore } from "@/lib/domain/priority";
import { SNOOZE_WAKE_HOUR, isSnoozed, toLocalIsoDate } from "@/lib/domain/snooze";
import { isTodayTaskOnDay } from "@/lib/domain/today";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";

export { isSnoozed };

/**
 * Composable view selectors.
 *
 * The rule of thumb: a "view" is a (filter, sort) pair plus optional
 * grouping. Selectors stay pure so they can be reused in tests and in
 * server-side code if persistence moves there.
 *
 * Every sidebar view except Today maps 1:1 to a status (`Lifecycle`), so
 * the nav, the Status picker, and a future Kanban board all agree on where
 * a task lives. Today is a smart lens over statuses, defined by
 * `isTodayTask` — the single predicate shared by the Today list and the
 * sidebar count so the two can never disagree.
 */

export interface ViewArgs {
  labelId?: string | null;
  search?: string;
}

function applyCommonFilters(tasks: Task[], args: ViewArgs): Task[] {
  let out = tasks;
  if (args.labelId) {
    out = out.filter((t) => t.labelIds.includes(args.labelId!));
  }
  if (args.search?.trim()) {
    const q = args.search.trim().toLowerCase();
    out = out.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.sourceText.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q),
    );
  }
  return out;
}

/**
 * Today membership on the browser's local day; the rule itself lives in
 * `lib/domain/today.ts` so the server-side daily plan applies the same one.
 */
export function isTodayTask(t: Task, now = new Date()): boolean {
  if (isSnoozed(t, now)) return false;
  return isTodayTaskOnDay(t, toLocalIsoDate(now));
}

function byFocusScore(now: Date) {
  return (a: Task, b: Task) =>
    focusScore({
      bucket: a.priorityBucket,
      importance: a.importance,
      urgency: a.urgency,
      due: a.due,
      now,
    }) -
    focusScore({
      bucket: b.priorityBucket,
      importance: b.importance,
      urgency: b.urgency,
      due: b.due,
      now,
    });
}

export function selectTodayTasks(tasks: Task[], args: ViewArgs = {}, now = new Date()): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => isTodayTask(t, now))
    .sort(byFocusScore(now));
}

export function selectInboxTasks(tasks: Task[], args: ViewArgs = {}, now = new Date()): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "inbox" && !isSnoozed(t, now))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Focus is exactly the "active" status — Inbox stays the review gate. */
export function selectFocusTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "active")
    .sort(byFocusScore(now));
}

export function selectByLifecycle(
  tasks: Task[],
  lifecycle: Lifecycle,
  args: ViewArgs = {},
): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === lifecycle)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/**
 * Board columns, left to right, mirroring the sidebar's pipeline order
 * (`STATUS_META` order). `dropped` is deliberately absent — the board is
 * for live work, and dropping stays an explicit action in the detail sheet.
 */
export const BOARD_LIFECYCLES = ["inbox", "active", "waiting", "someday", "done"] as const;
export type BoardLifecycle = (typeof BOARD_LIFECYCLES)[number];

export interface BoardColumn {
  lifecycle: BoardLifecycle;
  tasks: Task[];
}

/**
 * Group tasks into kanban columns. Each column keeps the sort its list
 * counterpart uses (inbox by capture time, active by focus score, done by
 * completion time) so switching views never reshuffles unexpectedly.
 */
export function selectBoardColumns(
  tasks: Task[],
  args: ViewArgs = {},
  now: Date = new Date(),
): BoardColumn[] {
  const filtered = applyCommonFilters(tasks, args);
  return BOARD_LIFECYCLES.map((lifecycle) => {
    const columnTasks = filtered.filter((t) => {
      if (t.lifecycle !== lifecycle) return false;
      // Inbox hides a snooze the same way the list does. Other columns stay
      // 1:1 with status, so a snoozed focus task remains on the board.
      if (lifecycle === "inbox" && isSnoozed(t, now)) return false;
      return true;
    });
    if (lifecycle === "inbox") {
      columnTasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } else if (lifecycle === "active") {
      columnTasks.sort(byFocusScore(now));
    } else if (lifecycle === "done") {
      columnTasks.sort((a, b) =>
        (a.completedAt ?? a.updatedAt) < (b.completedAt ?? b.updatedAt) ? 1 : -1,
      );
    } else {
      columnTasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }
    return { lifecycle, tasks: columnTasks };
  });
}

export function selectDoneTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "done")
    .sort((a, b) => ((a.completedAt ?? a.updatedAt) < (b.completedAt ?? b.updatedAt) ? 1 : -1));
}

export function selectDroppedTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  return selectByLifecycle(tasks, "dropped", args);
}

export interface TaskCounts {
  today: number;
  inbox: number;
  focus: number;
  waiting: number;
  someday: number;
  done: number;
  dropped: number;
  total: number;
}

/** Pure counterpart of `useTaskCounts`; uses the same predicates as the lists. */
export function computeTaskCounts(tasks: Task[], now = new Date()): TaskCounts {
  const counts: TaskCounts = {
    today: 0,
    inbox: 0,
    focus: 0,
    waiting: 0,
    someday: 0,
    done: 0,
    dropped: 0,
    total: tasks.length,
  };
  for (const t of tasks) {
    if (t.lifecycle === "done") {
      counts.done += 1;
      continue;
    }
    if (t.lifecycle === "dropped") {
      counts.dropped += 1;
      continue;
    }
    if (t.lifecycle === "inbox" && !isSnoozed(t, now)) counts.inbox += 1;
    if (t.lifecycle === "active") counts.focus += 1;
    if (t.lifecycle === "waiting") counts.waiting += 1;
    if (t.lifecycle === "someday") counts.someday += 1;
    if (isTodayTask(t, now)) counts.today += 1;
  }
  return counts;
}

/** Milliseconds until the next local 8:00, when snoozed tasks wake. */
function msUntilNextWake(now = new Date()): number {
  const next = new Date(now);
  next.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Bumps when a snooze could have woken: the next local 8:00, and whenever
 * the tab becomes visible again (timers stall while a tab is in the background).
 * Lists and badges memoize on the task array; they take this so a wake
 * re-renders without a reload or a write.
 */
export function useSnoozeClock(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let timer = 0;
    const bump = () => setEpoch((n) => n + 1);
    const arm = () => {
      timer = window.setTimeout(() => {
        bump();
        arm();
      }, msUntilNextWake());
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      bump();
      arm();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return epoch;
}

export function useTaskCounts(): TaskCounts {
  const tasks = useStore((s) => s.tasks);
  const snoozeClock = useSnoozeClock();
  // The callback reads `new Date()`. The clock is only the signal that local time moved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snoozeClock invalidates the memo at 8:00 and on tab focus.
  return useMemo(() => computeTaskCounts(tasks), [tasks, snoozeClock]);
}
