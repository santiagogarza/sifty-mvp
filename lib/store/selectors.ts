"use client";

import { focusScore } from "@/lib/domain/priority";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { dayDelta, isOverdue } from "@/lib/utils/dates";
import { useMemo } from "react";
import { useStore } from "./store";

/**
 * Composable view selectors.
 *
 * The rule of thumb: a "view" is a (filter, sort) pair plus optional
 * grouping. Selectors stay pure so they can be reused in tests and in
 * server-side code if persistence moves there.
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

export function selectTodayTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const filtered = applyCommonFilters(tasks, args).filter(
    (t) => t.lifecycle !== "done" && t.lifecycle !== "dropped",
  );
  const now = new Date();
  return filtered
    .filter((t) => {
      if (isOverdue(t.due, now)) return true;
      if (t.due && dayDelta(new Date(t.due), now) === 0) return true;
      if (t.priorityBucket === "do_now") return true;
      return false;
    })
    .sort(
      (a, b) =>
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
        }),
    );
}

export function selectInboxTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "inbox")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function selectFocusTasks(tasks: Task[], args: ViewArgs = {}): Task[] {
  const now = new Date();
  return applyCommonFilters(tasks, args)
    .filter((t) => t.lifecycle === "active" || t.lifecycle === "inbox")
    .sort(
      (a, b) =>
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
        }),
    );
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
 * Board columns, left to right, mirroring the sidebar's pipeline order.
 * `dropped` is deliberately absent — the board is for live work, and
 * dropping stays an explicit action in the detail sheet.
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
    const columnTasks = filtered.filter((t) => t.lifecycle === lifecycle);
    if (lifecycle === "inbox") {
      columnTasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } else if (lifecycle === "active") {
      columnTasks.sort(
        (a, b) =>
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
          }),
      );
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

export function useTaskCounts() {
  const tasks = useStore((s) => s.tasks);
  return useMemo(() => {
    const now = new Date();
    let today = 0;
    let inbox = 0;
    let focus = 0;
    let waiting = 0;
    let someday = 0;
    let done = 0;
    for (const t of tasks) {
      if (t.lifecycle === "done") {
        done += 1;
        continue;
      }
      if (t.lifecycle === "dropped") continue;
      if (t.lifecycle === "inbox") inbox += 1;
      if (t.lifecycle === "active" || t.lifecycle === "inbox") {
        focus += 1;
        const isOver = isOverdue(t.due, now);
        const dueToday = t.due && dayDelta(new Date(t.due), now) === 0;
        if (isOver || dueToday || t.priorityBucket === "do_now") today += 1;
      }
      if (t.lifecycle === "waiting") waiting += 1;
      if (t.lifecycle === "someday") someday += 1;
    }
    return { today, inbox, focus, waiting, someday, done, total: tasks.length };
  }, [tasks]);
}
