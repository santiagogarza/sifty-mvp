"use client";

import { focusScore } from "@/lib/domain/priority";
import { isSnoozed } from "@/lib/domain/snooze";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { dayDelta, isOverdue } from "@/lib/utils/dates";
import { useMemo } from "react";
import { useStore } from "./store";
import { useToday } from "./use-today";

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
 *
 * Snooze cuts across statuses: a snoozed task is hidden from every open
 * view (Today, Inbox, Focus, Waiting on, Someday) until its wake day and
 * listed in Snoozed instead. Done and Dropped ignore it.
 */

export interface ViewArgs {
  labelId?: string | null;
  search?: string;
  /** Defaults to the current time; views pass `useToday()`. */
  now?: Date;
}

function isOpen(lifecycle: Lifecycle): boolean {
  return lifecycle !== "done" && lifecycle !== "dropped";
}

/** Membership in the status view for `lifecycle`, snooze-aware. */
function inStatusView(t: Task, lifecycle: Lifecycle, now: Date): boolean {
  return t.lifecycle === lifecycle && (!isOpen(lifecycle) || !isSnoozed(t, now));
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
 * Today membership:
 *  - Inbox/Focus tasks that are overdue, due today, or read as urgent +
 *    important (`do_now`) — your ball, today.
 *  - Waiting-on tasks only when a deadline forces them (overdue/due today):
 *    the ball is elsewhere, but the date arrives regardless — chase it.
 *  - Someday never resurfaces (an explicit "not now"), and done/dropped
 *    are out of play.
 *  - Snoozed tasks wait for their wake day, deadline or not.
 */
export function isTodayTask(t: Task, now = new Date()): boolean {
  if (isSnoozed(t, now)) return false;
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
  const now = args.now ?? new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => isTodayTask(t, now))
    .sort(byFocusScore(now));
}

export function selectInboxTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = args.now ?? new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => inStatusView(t, "inbox", now))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Focus is exactly the "active" status — Inbox stays the review gate. */
export function selectFocusTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = args.now ?? new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => inStatusView(t, "active", now))
    .sort(byFocusScore(now));
}

export function selectByLifecycle(
  tasks: Task[],
  lifecycle: Lifecycle,
  args: ViewArgs = {},
): Task[] {
  const now = args.now ?? new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => inStatusView(t, lifecycle, now))
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

/** Open tasks waiting for a wake day, soonest first. */
export function selectSnoozedTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = args.now ?? new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => isOpen(t.lifecycle) && isSnoozed(t, now))
    .sort((a, b) => {
      const byWake = (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? "");
      return byWake !== 0 ? byWake : a.updatedAt < b.updatedAt ? 1 : -1;
    });
}

export interface TaskCounts {
  today: number;
  inbox: number;
  focus: number;
  waiting: number;
  someday: number;
  snoozed: number;
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
    snoozed: 0,
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
    if (isSnoozed(t, now)) {
      counts.snoozed += 1;
      continue;
    }
    if (t.lifecycle === "inbox") counts.inbox += 1;
    if (t.lifecycle === "active") counts.focus += 1;
    if (t.lifecycle === "waiting") counts.waiting += 1;
    if (t.lifecycle === "someday") counts.someday += 1;
    if (isTodayTask(t, now)) counts.today += 1;
  }
  return counts;
}

export function useTaskCounts(): TaskCounts {
  const tasks = useStore((s) => s.tasks);
  const now = useToday();
  return useMemo(() => computeTaskCounts(tasks, now), [tasks, now]);
}
