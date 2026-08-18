import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  type ViewArgs,
  selectByLifecycle,
  selectDoneTasks,
  selectDroppedTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";

/** Lifecycles `isTodayTask` can return true for — the Today board columns. */
export const TODAY_BOARD_COLUMNS: readonly Lifecycle[] = ["inbox", "active", "waiting"];

const EMPTY: Task[] = [];

function emptyBuckets(): Record<Lifecycle, Task[]> {
  return {
    inbox: EMPTY,
    active: EMPTY,
    waiting: EMPTY,
    someday: EMPTY,
    done: EMPTY,
    dropped: EMPTY,
  };
}

/**
 * Partition tasks into lifecycle columns using the same filters and
 * per-column sorts as the list views. Tasks whose lifecycle is not in
 * `columns` are omitted (never silently remapped).
 */
export function partitionByLifecycle(
  tasks: Task[],
  args: ViewArgs = {},
  columns: readonly Lifecycle[] = STATUSES_IN_ORDER,
): Record<Lifecycle, Task[]> {
  const out = emptyBuckets();
  const wanted = new Set(columns);
  if (wanted.has("inbox")) out.inbox = selectInboxTasks(tasks, args);
  if (wanted.has("active")) out.active = selectFocusTasks(tasks, args);
  if (wanted.has("waiting")) out.waiting = selectByLifecycle(tasks, "waiting", args);
  if (wanted.has("someday")) out.someday = selectByLifecycle(tasks, "someday", args);
  if (wanted.has("done")) out.done = selectDoneTasks(tasks, args);
  if (wanted.has("dropped")) out.dropped = selectDroppedTasks(tasks, args);
  return out;
}

export function droppableId(lifecycle: Lifecycle): string {
  return `column:${lifecycle}`;
}

export function lifecycleFromDroppableId(id: string | undefined | null): Lifecycle | null {
  if (!id?.startsWith("column:")) return null;
  const value = id.slice("column:".length);
  return (STATUSES_IN_ORDER as readonly string[]).includes(value) ? (value as Lifecycle) : null;
}

/**
 * Commit a cross-column drop. Same-column drops are a no-op (no sortOrder).
 */
export function resolveBoardDrop(
  taskId: string,
  overId: string | undefined | null,
  tasks: Task[],
): { taskId: string; lifecycle: Lifecycle } | null {
  const over = lifecycleFromDroppableId(overId);
  if (!over) return null;
  const task = tasks.find((t) => t.id === taskId);
  if (!task || task.lifecycle === over) return null;
  return { taskId, lifecycle: over };
}

export function adjacentLifecycle(
  current: Lifecycle,
  delta: -1 | 1,
  columns: readonly Lifecycle[],
): Lifecycle | null {
  const index = columns.indexOf(current);
  if (index < 0) return null;
  return columns[index + delta] ?? null;
}
