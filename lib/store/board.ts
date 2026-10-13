import type { Lifecycle, Task } from "@/lib/domain/types";
import { type ViewArgs, applyCommonFilters, isTodayTask, sortTasksForLifecycle } from "./selectors";

export interface BoardPartitionArgs extends ViewArgs {
  todayOnly?: boolean;
  now?: Date;
}

export type LifecyclePartition = Record<Lifecycle, Task[]>;

export function partitionByLifecycle(
  tasks: Task[],
  args: BoardPartitionArgs,
  columns: readonly Lifecycle[],
): LifecyclePartition {
  const partition: LifecyclePartition = {
    inbox: [],
    active: [],
    waiting: [],
    someday: [],
    done: [],
    dropped: [],
  };
  const visibleColumns = new Set(columns);
  const filtered = applyCommonFilters(tasks, args);
  const now = args.now ?? new Date();

  for (const task of filtered) {
    if (!visibleColumns.has(task.lifecycle)) continue;
    if (args.todayOnly && !isTodayTask(task, now)) continue;
    partition[task.lifecycle].push(task);
  }

  for (const lifecycle of columns) {
    partition[lifecycle] = sortTasksForLifecycle(partition[lifecycle], lifecycle);
  }

  return partition;
}
