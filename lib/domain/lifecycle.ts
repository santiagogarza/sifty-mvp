import type { Lifecycle } from "@/lib/domain/types";

/**
 * Lifecycle columns shown on the board. `dropped` stays out of the board —
 * those tasks are intentionally removed from the working set and remain
 * reachable from the detail sheet only.
 */
export const BOARD_COLUMNS = ["inbox", "active", "waiting", "someday", "done"] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export function lifecycleLabel(lifecycle: Lifecycle): string {
  return {
    inbox: "Inbox",
    active: "Active",
    waiting: "Waiting",
    someday: "Someday",
    done: "Done",
    dropped: "Dropped",
  }[lifecycle];
}

export function isBoardColumn(lifecycle: Lifecycle): lifecycle is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(lifecycle);
}

/** Adjacent column for keyboard moves on the board. */
export function adjacentBoardColumn(current: Lifecycle, direction: -1 | 1): BoardColumn | null {
  if (!isBoardColumn(current)) return null;
  const index = BOARD_COLUMNS.indexOf(current);
  const next = BOARD_COLUMNS[index + direction];
  return next ?? null;
}
