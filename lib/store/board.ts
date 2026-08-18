"use client";

import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  type ViewArgs,
  selectByLifecycle,
  selectDoneTasks,
  selectDroppedTasks,
  selectFocusTasks,
  selectInboxTasks,
  selectTodayTasks,
} from "./selectors";

/**
 * Board partitioning.
 *
 * A column is just a status plus the tasks the corresponding list view would
 * show. Each column delegates to the very selector that backs its list route,
 * so a column can never disagree with its list about membership, order, or
 * which filters apply — the parity is structural, not a convention someone has
 * to remember. The board adds no filtering of its own.
 */

export interface BoardColumn {
  status: Lifecycle;
  tasks: Task[];
}

const COLUMN_SELECTORS: Record<Lifecycle, (tasks: Task[], args: ViewArgs) => Task[]> = {
  inbox: selectInboxTasks,
  active: selectFocusTasks,
  waiting: (tasks, args) => selectByLifecycle(tasks, "waiting", args),
  someday: (tasks, args) => selectByLifecycle(tasks, "someday", args),
  done: selectDoneTasks,
  dropped: selectDroppedTasks,
};

/**
 * The default pipeline. Dropped is excluded: it has no route of its own and
 * stays behind a disclosure, the same bargain the Done page already strikes.
 */
export const BOARD_COLUMNS: readonly Lifecycle[] = STATUSES_IN_ORDER.filter((s) => s !== "dropped");

/**
 * Today is a lens, not a status, so its board keeps the lens and shows only
 * the statuses `isTodayTask` can admit. Widening it to the full pipeline would
 * make the Today board identical to every other board and would surface the
 * Someday and Done work Today deliberately holds back.
 */
export const TODAY_BOARD_COLUMNS: readonly Lifecycle[] = ["inbox", "active", "waiting"];

export function selectBoardColumns(
  tasks: Task[],
  columns: readonly Lifecycle[] = BOARD_COLUMNS,
  args: ViewArgs = {},
): BoardColumn[] {
  return columns.map((status) => ({ status, tasks: COLUMN_SELECTORS[status](tasks, args) }));
}

/**
 * Today's board: the Today list's own membership, split across the statuses
 * those tasks actually hold. Ordering stays the Today list's focus-score
 * ordering, so a column reads as that slice of the list, top to bottom.
 */
export function selectTodayBoardColumns(
  todayTasks: Task[],
  columns: readonly Lifecycle[] = TODAY_BOARD_COLUMNS,
): BoardColumn[] {
  return columns.map((status) => ({
    status,
    tasks: todayTasks.filter((t) => t.lifecycle === status),
  }));
}

/**
 * How a given route builds its board. Declared as module-level constants so a
 * view can pass one down without rebuilding the partition function on every
 * render, the same arrangement the list views use for their selectors.
 */
export interface BoardConfig {
  partition: (tasks: Task[], args?: ViewArgs) => BoardColumn[];
  /** Whether this board offers the "Show dropped" disclosure. */
  offersDropped: boolean;
}

export const PIPELINE_BOARD: BoardConfig = {
  partition: (tasks, args) => selectBoardColumns(tasks, BOARD_COLUMNS, args),
  offersDropped: true,
};

/** Today has no Dropped to disclose — the lens excludes it by definition. */
export const TODAY_BOARD: BoardConfig = {
  partition: (tasks, args) => selectTodayBoardColumns(selectTodayTasks(tasks, args)),
  offersDropped: false,
};
