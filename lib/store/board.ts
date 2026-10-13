import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import { LIFECYCLE, type Lifecycle, type Task } from "@/lib/domain/types";
import { type ViewArgs, applyCommonFilters, isTodayTask, lifecycleComparator } from "./selectors";

/**
 * Pure core of the board (kanban) view.
 *
 * Columns are the stored `Lifecycle` values in pipeline order — the board
 * introduces no new vocabulary and no schema. A "lens" narrows what the
 * board shows: the standard lens is the full pipeline with Dropped behind
 * a disclosure; the Today lens keeps `isTodayTask` and only the three
 * statuses that predicate can return true for.
 */

export interface BoardArgs extends ViewArgs {
  /** Extra lens predicate applied before partitioning (Today's `isTodayTask`). */
  filter?: (task: Task, now: Date) => boolean;
}

export interface BoardLens {
  /** Always-visible columns, in pipeline order. Never includes `dropped`. */
  columns: readonly Lifecycle[];
  filter?: BoardArgs["filter"];
  /** Whether the trailing "Show dropped" disclosure is available. */
  withDropped: boolean;
}

/** Standard lens: the full pipeline, Dropped behind the disclosure. */
export const DEFAULT_BOARD_LENS: BoardLens = {
  columns: STATUSES_IN_ORDER.filter((s) => s !== "dropped"),
  withDropped: true,
};

/**
 * Today lens: same membership as the Today list. The columns are exactly
 * the lifecycles `isTodayTask` can return true for, so Someday/Done/Dropped
 * work never surfaces on the Today board.
 */
export const TODAY_BOARD_LENS: BoardLens = {
  columns: STATUSES_IN_ORDER.filter((s) => s === "inbox" || s === "active" || s === "waiting"),
  filter: isTodayTask,
  withDropped: false,
};

/**
 * Partition tasks into one column per lifecycle, in a single pass.
 *
 * - Label/search filters go through `applyCommonFilters`, the same function
 *   the list selectors use, so the two views can never disagree.
 * - Tasks whose lifecycle is not in `columns` are excluded entirely.
 * - Within-column order comes from `lifecycleComparator` — the same sorts
 *   as the matching list views. Dropping a card onto a different slot in
 *   its own column is therefore a no-op by design.
 */
export function partitionByLifecycle(
  tasks: Task[],
  args: BoardArgs = {},
  columns: readonly Lifecycle[] = STATUSES_IN_ORDER,
  now = new Date(),
): Record<Lifecycle, Task[]> {
  const partition: Record<Lifecycle, Task[]> = {
    inbox: [],
    active: [],
    waiting: [],
    someday: [],
    done: [],
    dropped: [],
  };
  const included = new Set(columns);
  for (const task of applyCommonFilters(tasks, args)) {
    if (!included.has(task.lifecycle)) continue;
    if (args.filter && !args.filter(task, now)) continue;
    partition[task.lifecycle].push(task);
  }
  for (const lifecycle of included) {
    partition[lifecycle].sort(lifecycleComparator(lifecycle, now));
  }
  return partition;
}

/**
 * Resolve a drag-drop into the status mutation it means, or null when the
 * drop is a no-op (no target, unknown target, the card is already in the
 * target column — within-column position is derived, not stored — or a
 * lens filter would hide the card after the move).
 */
export function resolveDrop(
  tasks: readonly Task[],
  activeId: string,
  overId: string | number | null | undefined,
  args: Pick<BoardArgs, "filter"> = {},
  now = new Date(),
): { taskId: string; lifecycle: Lifecycle } | null {
  if (overId == null) return null;
  const target = String(overId);
  if (!(LIFECYCLE as readonly string[]).includes(target)) return null;
  const lifecycle = target as Lifecycle;
  const task = tasks.find((t) => t.id === activeId);
  if (!task || task.lifecycle === lifecycle) return null;
  if (args.filter && !args.filter({ ...task, lifecycle }, now)) return null;
  return { taskId: task.id, lifecycle };
}

/**
 * The column one step left/right of `from` among the visible columns, for
 * the Alt+←/→ keyboard move. Null at either end — a deliberate no-op.
 */
export function adjacentColumn(
  columns: readonly Lifecycle[],
  from: Lifecycle,
  direction: -1 | 1,
): Lifecycle | null {
  const index = columns.indexOf(from);
  if (index === -1) return null;
  return columns[index + direction] ?? null;
}
