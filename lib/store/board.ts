import type { Lifecycle, Task } from "@/lib/domain/types";
import { type ViewArgs, applyCommonFilters, byFocusScore, isTodayTask } from "./selectors";

/** True when assigning `lifecycle` would keep the card visible on this board. */
export function staysVisibleOnBoard(
  task: Task,
  lifecycle: Lifecycle,
  isTodayBoard: boolean,
): boolean {
  if (!isTodayBoard) return true;
  return isTodayTask({ ...task, lifecycle });
}

export function partitionByLifecycle(
  tasks: Task[],
  args: ViewArgs,
  columns: readonly Lifecycle[],
  isTodayBoard = false,
): Record<Lifecycle, Task[]> {
  const filtered = applyCommonFilters(tasks, args);
  const now = new Date();

  const partitions: Record<Lifecycle, Task[]> = {
    inbox: [],
    active: [],
    waiting: [],
    someday: [],
    done: [],
    dropped: [],
  };

  for (const t of filtered) {
    if (isTodayBoard && !isTodayTask(t, now)) {
      continue;
    }
    if (columns.includes(t.lifecycle)) {
      partitions[t.lifecycle].push(t);
    }
  }

  partitions.inbox.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  partitions.active.sort(byFocusScore(now));
  partitions.waiting.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  partitions.someday.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  partitions.done.sort((a, b) =>
    (a.completedAt ?? a.updatedAt) < (b.completedAt ?? b.updatedAt) ? 1 : -1,
  );
  partitions.dropped.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return partitions;
}
