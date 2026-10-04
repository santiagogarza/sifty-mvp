import { STATUS_VIEWS, type StatusView } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";

/** Columns are the statuses that have a view. Dropped is not one of them. */
export const BOARD_COLUMNS: readonly StatusView[] = STATUS_VIEWS;

export const BOARD_POINTER_DISTANCE = 8;
export const BOARD_TOUCH_DELAY_MS = 250;
export const BOARD_UNDO_MS = 6000;

const BOARD_STATUSES = new Set<string>(BOARD_COLUMNS.map((column) => column.status));

export function isBoardStatus(value: unknown): value is Lifecycle {
  return typeof value === "string" && BOARD_STATUSES.has(value);
}

export function tasksForBoardColumn(tasks: Task[], status: Lifecycle): Task[] {
  switch (status) {
    case "inbox":
      return selectInboxTasks(tasks);
    case "active":
      return selectFocusTasks(tasks);
    case "done":
      return selectDoneTasks(tasks);
    case "waiting":
    case "someday":
    case "dropped":
      return selectByLifecycle(tasks, status);
    default:
      return [];
  }
}

export interface BoardColumnData {
  status: Lifecycle;
  label: string;
  tasks: Task[];
}

export function partitionBoard(tasks: Task[]): BoardColumnData[] {
  return BOARD_COLUMNS.map((column) => ({
    status: column.status,
    label: column.label,
    tasks: tasksForBoardColumn(tasks, column.status),
  }));
}

export function adjacentLifecycle(status: Lifecycle, dir: -1 | 1): Lifecycle | null {
  const index = BOARD_COLUMNS.findIndex((column) => column.status === status);
  if (index < 0) return null;
  return BOARD_COLUMNS[index + dir]?.status ?? null;
}

export function cardPosition(
  columns: BoardColumnData[],
  taskId: string,
): { col: number; index: number } | null {
  for (let col = 0; col < columns.length; col++) {
    const index = columns[col]?.tasks.findIndex((task) => task.id === taskId) ?? -1;
    if (index >= 0) return { col, index };
  }
  return null;
}

/**
 * Move the highlight. Empty columns are skipped so the selection always
 * sits on a card; the index is clamped to whatever column it lands in.
 */
export function moveSelection(
  columns: BoardColumnData[],
  selectedId: string | null,
  delta: { col?: number; index?: number },
): string | null {
  if (columns.every((column) => column.tasks.length === 0)) return null;
  const pos = selectedId ? cardPosition(columns, selectedId) : null;
  if (!pos) {
    const col = columns.findIndex((column) => column.tasks.length > 0);
    return columns[col]?.tasks[0]?.id ?? null;
  }
  if (delta.index) {
    const tasks = columns[pos.col]?.tasks ?? [];
    const index = Math.min(tasks.length - 1, Math.max(0, pos.index + delta.index));
    return tasks[index]?.id ?? selectedId;
  }
  if (delta.col) {
    const step = delta.col > 0 ? 1 : -1;
    let col = pos.col;
    while (true) {
      col += step;
      if (col < 0 || col >= columns.length) return selectedId;
      const tasks = columns[col]?.tasks ?? [];
      if (tasks.length === 0) continue;
      const index = Math.min(pos.index, tasks.length - 1);
      return tasks[index]?.id ?? selectedId;
    }
  }
  return selectedId;
}

export function columnCount(
  column: BoardColumnData,
  active: Task | null,
  over: Lifecycle | null,
): number {
  const base = column.tasks.length;
  if (!active) return base;
  const from = active.lifecycle;
  if (!isBoardStatus(from)) return base;
  const leaving = over !== from;
  if (column.status === from && leaving) return Math.max(0, base - 1);
  if (over && column.status === over && over !== from) return base + 1;
  return base;
}
