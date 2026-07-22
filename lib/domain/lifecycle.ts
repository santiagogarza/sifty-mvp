import type { Lifecycle } from "./types";

/** Human-readable labels for lifecycle stages. */
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

/** Columns shown on the Kanban board, left to right. */
export const BOARD_COLUMNS: Lifecycle[] = ["inbox", "active", "waiting", "someday", "done"];
