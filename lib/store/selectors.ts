"use client";

import { focusScore } from "@/lib/domain/priority";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { dayDelta, isOverdue } from "@/lib/utils/dates";
import { isSnoozed } from "@/lib/utils/snooze";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";

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

/** Snoozed open tasks leave every view until they wake; done/dropped ignore snooze. */
function isHiddenBySnooze(t: Task, now: Date): boolean {
  return t.lifecycle !== "done" && t.lifecycle !== "dropped" && isSnoozed(t, now);
}

function applyCommonFilters(tasks: Task[], args: ViewArgs, now = new Date()): Task[] {
  let out = tasks.filter((t) => !isHiddenBySnooze(t, now));
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
 * Today membership:
 *  - Inbox/Focus tasks that are overdue, due today, or read as urgent +
 *    important (`do_now`) — your ball, today.
 *  - Waiting-on tasks only when a deadline forces them (overdue/due today):
 *    the ball is elsewhere, but the date arrives regardless — chase it.
 *  - Someday never resurfaces (an explicit "not now"), and done/dropped
 *    are out of play.
 */
export function isTodayTask(t: Task, now = new Date()): boolean {
  if (isHiddenBySnooze(t, now)) return false;
  const dueForces = isOverdue(t.due, now) || (!!t.due && dayDelta(new Date(t.due), now) === 0);
  if (t.lifecycle === "inbox" || t.lifecycle === "active") {
    return dueForces || t.priorityBucket === "do_now";
  }
  if (t.lifecycle === "waiting") return dueForces;
  return false;
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

export function selectTodayTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = new Date();
  return applyCommonFilters(tasks, args, now)
    .filter((t) => isTodayTask(t, now))
    .sort(byFocusScore(now));
}

export function selectInboxTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "inbox")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Focus is exactly the "active" status — Inbox stays the review gate. */
export function selectFocusTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = new Date();
  return applyCommonFilters(tasks, args, now)
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
    if (isHiddenBySnooze(t, now)) continue;
    if (t.lifecycle === "inbox") counts.inbox += 1;
    if (t.lifecycle === "active") counts.focus += 1;
    if (t.lifecycle === "waiting") counts.waiting += 1;
    if (t.lifecycle === "someday") counts.someday += 1;
    if (isTodayTask(t, now)) counts.today += 1;
  }
  return counts;
}

/** setTimeout overflows past ~24.8 days and would fire immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Changes value when the next snoozed task wakes, so memoized views
 * recompute and the task reappears on time without another store change.
 */
export function useSnoozeWakeTick(tasks: Task[]): number {
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-arms the timer after each wake.
  useEffect(() => {
    const now = Date.now();
    let next = Number.POSITIVE_INFINITY;
    for (const t of tasks) {
      if (!t.snoozedUntil) continue;
      const at = new Date(t.snoozedUntil).getTime();
      if (at > now && at < next) next = at;
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.min(next - now, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [tasks, tick]);
  return tick;
}

export function useTaskCounts(): TaskCounts {
  const tasks = useStore((s) => s.tasks);
  const wake = useSnoozeWakeTick(tasks);
  // biome-ignore lint/correctness/useExhaustiveDependencies: wake forces a recompute when a snooze ends.
  return useMemo(() => computeTaskCounts(tasks), [tasks, wake]);
}
