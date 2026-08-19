import { focusScore } from "@/lib/domain/priority";
import { STATUSES_IN_ORDER } from "@/lib/domain/status";
import type { Lifecycle, Task } from "@/lib/domain/types";
import { type ViewArgs, isTodayTask } from "./selectors";

export interface PartitionArgs extends ViewArgs {
  /** When set, only tasks passing this predicate are placed into columns. */
  taskFilter?: (task: Task, now: Date) => boolean;
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

function sortColumn(lifecycle: Lifecycle, tasks: Task[], now: Date): Task[] {
  const sorted = [...tasks];
  switch (lifecycle) {
    case "inbox":
      return sorted.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    case "active":
      return sorted.sort(
        (a, b) =>
          focusScore({
            bucket: b.priorityBucket,
            importance: b.importance,
            urgency: b.urgency,
            due: b.due,
            now,
          }) -
          focusScore({
            bucket: a.priorityBucket,
            importance: a.importance,
            urgency: a.urgency,
            due: a.due,
            now,
          }),
      );
    case "done":
      return sorted.sort((a, b) =>
        (a.completedAt ?? a.updatedAt) < (b.completedAt ?? b.updatedAt) ? 1 : -1,
      );
    default:
      return sorted.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
}

/**
 * Pure partition of tasks into Kanban columns. Applies the same label/search
 * filters as list selectors; optional `taskFilter` implements lenses like Today.
 */
export function partitionByLifecycle(
  tasks: Task[],
  args: PartitionArgs = {},
  columns: readonly Lifecycle[] = STATUSES_IN_ORDER,
  now = new Date(),
): Record<Lifecycle, Task[]> {
  const filtered = applyCommonFilters(tasks, args).filter((t) =>
    args.taskFilter ? args.taskFilter(t, now) : true,
  );

  const result = {} as Record<Lifecycle, Task[]>;
  for (const lifecycle of STATUSES_IN_ORDER) {
    result[lifecycle] = [];
  }

  for (const task of filtered) {
    if (columns.includes(task.lifecycle)) {
      result[task.lifecycle].push(task);
    }
  }

  for (const lifecycle of columns) {
    result[lifecycle] = sortColumn(lifecycle, result[lifecycle], now);
  }

  return result;
}

/** Columns visible on the Today board — the three lifecycles Today can surface. */
export const TODAY_BOARD_COLUMNS: readonly Lifecycle[] = ["inbox", "active", "waiting"];

/** Default board columns — full pipeline minus dropped (revealed via disclosure). */
export const DEFAULT_BOARD_COLUMNS: readonly Lifecycle[] = STATUSES_IN_ORDER.filter(
  (s) => s !== "dropped",
);

export { isTodayTask };
