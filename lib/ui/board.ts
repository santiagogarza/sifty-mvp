import { STATUS_VIEWS, type StatusView } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import {
  type ViewArgs,
  selectByLifecycle,
  selectDoneTasks,
  selectFocusTasks,
  selectInboxTasks,
} from "@/lib/store/selectors";

/** Column identity, order, labels, and routes. Dropped is absent (`href: null`). */
export const BOARD_COLUMNS: readonly StatusView[] = STATUS_VIEWS;

export type BoardStatus = Exclude<Lifecycle, "dropped">;

export const BOARD_POINTER_DISTANCE_PX = 8;
export const BOARD_TOUCH_DELAY_MS = 250;
export const BOARD_UNDO_MS = 6_000;

export const BOARD_COPY = {
  eyebrow: "BOARD",
  title: "Everything, by status",
  description:
    "Drag a card to another column to file it. Same order, words, and icons as the sidebar.",
} as const;

const TASK_ROUTES = new Set(["/today", "/inbox", "/focus", "/waiting", "/someday", "/done"]);

export function isTaskRoute(pathname: string): boolean {
  return TASK_ROUTES.has(pathname);
}

/** Same sorts as the list pages, so a card doesn't reshuffle when you toggle. */
export function partitionBoard(tasks: Task[], args: ViewArgs = {}): Record<BoardStatus, Task[]> {
  return {
    inbox: selectInboxTasks(tasks, args),
    active: selectFocusTasks(tasks, args),
    waiting: selectByLifecycle(tasks, "waiting", args),
    someday: selectByLifecycle(tasks, "someday", args),
    done: selectDoneTasks(tasks, args),
  };
}

const BOARD_STATUS_ORDER = ["inbox", "active", "waiting", "someday", "done"] as const;

export function toBoardStatus(status: string | null | undefined): BoardStatus | null {
  return BOARD_STATUS_ORDER.find((entry) => entry === status) ?? null;
}

/** Dropping on the same column, or on nothing, is not a write. */
export function resolveBoardDrop(
  from: Lifecycle,
  over: string | null | undefined,
): BoardStatus | null {
  const target = toBoardStatus(over);
  if (!target || target === from) return null;
  return target;
}

export function adjacentBoardStatus(status: BoardStatus, delta: -1 | 1): BoardStatus | null {
  const index = BOARD_STATUS_ORDER.indexOf(status);
  return BOARD_STATUS_ORDER[index + delta] ?? null;
}
