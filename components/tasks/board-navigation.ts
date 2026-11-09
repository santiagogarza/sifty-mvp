import type { Lifecycle } from "@/lib/domain/types";

/**
 * Pure keyboard model for the board. Selection is a task id rather than a
 * position, so it survives re-sorts and follows a card into a new column.
 */

export interface NavColumn {
  status: Lifecycle;
  tasks: ReadonlyArray<{ id: string }>;
}

export type NavDirection = "up" | "down" | "left" | "right";

export interface BoardPosition {
  column: number;
  row: number;
}

export function locate(columns: readonly NavColumn[], id: string | null): BoardPosition | null {
  if (!id) return null;
  for (let column = 0; column < columns.length; column++) {
    const row = columns[column]!.tasks.findIndex((t) => t.id === id);
    if (row !== -1) return { column, row };
  }
  return null;
}

/**
 * Where the selection lands after an arrow key. Up/down stay inside the
 * column (clamped at the ends). Left/right jump to the nearest non-empty
 * column in that direction, keeping the row when that column is long
 * enough. With nothing (or a stale id) selected, any arrow picks the first
 * card on the board.
 */
export function navigate(
  columns: readonly NavColumn[],
  selectedId: string | null,
  direction: NavDirection,
): string | null {
  const at = locate(columns, selectedId);
  if (!at) {
    for (const column of columns) {
      const first = column.tasks[0];
      if (first) return first.id;
    }
    return null;
  }

  const current = columns[at.column]!.tasks;
  if (direction === "up") return current[Math.max(0, at.row - 1)]!.id;
  if (direction === "down") return current[Math.min(current.length - 1, at.row + 1)]!.id;

  const step = direction === "left" ? -1 : 1;
  for (let c = at.column + step; c >= 0 && c < columns.length; c += step) {
    const tasks = columns[c]!.tasks;
    if (tasks.length > 0) return tasks[Math.min(at.row, tasks.length - 1)]!.id;
  }
  return selectedId;
}

/** The status one column over, or null at either end of the board. */
export function adjacentStatus(
  statuses: readonly Lifecycle[],
  status: Lifecycle,
  direction: "left" | "right",
): Lifecycle | null {
  const index = statuses.indexOf(status);
  if (index === -1) return null;
  return statuses[index + (direction === "left" ? -1 : 1)] ?? null;
}
