import { STATUS_VIEWS } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";

/**
 * Board columns are the statuses that have a page. Dropped has no column,
 * same as the sidebar (`href: null`). Today is a lens, not a column.
 */
export const BOARD_COLUMNS = STATUS_VIEWS;

const COLUMN_IDS = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

export function isBoardStatus(status: Lifecycle): boolean {
  return COLUMN_IDS.has(status);
}

/** Cards in one column, in the same order as that status's list view. */
export function tasksForColumn(tasks: Task[], lifecycle: Lifecycle): Task[] {
  switch (lifecycle) {
    case "inbox":
      return selectInboxTasks(tasks);
    case "active":
      return selectFocusTasks(tasks);
    case "waiting":
    case "someday":
      return selectByLifecycle(tasks, lifecycle);
    case "done":
      return selectDoneTasks(tasks);
    default:
      return [];
  }
}

/**
 * Where a drop should file the card. Same-column drops, misses, and
 * anything that is not a board column (including Dropped) are no-ops.
 */
export function boardDropTarget(from: Lifecycle, overId: string | null): Lifecycle | null {
  if (!overId || overId === from) return null;
  if (!COLUMN_IDS.has(overId)) return null;
  return overId as Lifecycle;
}
