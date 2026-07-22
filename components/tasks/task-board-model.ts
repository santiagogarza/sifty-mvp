import type { Lifecycle } from "@/lib/domain/types";

export const TASK_BOARD_COLUMNS: Array<{ lifecycle: Lifecycle; title: string }> = [
  { lifecycle: "inbox", title: "Inbox" },
  { lifecycle: "active", title: "Focus" },
  { lifecycle: "waiting", title: "Waiting" },
  { lifecycle: "someday", title: "Someday" },
  { lifecycle: "done", title: "Done" },
];

export const TASK_BOARD_LIFECYCLES = TASK_BOARD_COLUMNS.map((column) => column.lifecycle);

export function isTaskBoardLifecycle(lifecycle: Lifecycle): boolean {
  return TASK_BOARD_LIFECYCLES.includes(lifecycle);
}

export function taskBoardLifecycleAfter(lifecycle: Lifecycle, offset: -1 | 1): Lifecycle | null {
  const index = TASK_BOARD_LIFECYCLES.indexOf(lifecycle);
  if (index < 0) return null;
  return TASK_BOARD_LIFECYCLES[index + offset] ?? null;
}
