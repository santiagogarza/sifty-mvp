import type { Lifecycle } from "./types";

/** Human label for a GTD lifecycle stage. Shared by pickers, board columns, and announcements. */
export function lifecycleLabel(l: Lifecycle): string {
  return {
    inbox: "Inbox",
    active: "Active",
    waiting: "Waiting",
    someday: "Someday",
    done: "Done",
    dropped: "Dropped",
  }[l];
}

/**
 * The stages that appear as board columns, in pipeline order. `dropped` is
 * deliberately absent: it's an archive, not a stage work moves through.
 */
export const BOARD_LIFECYCLES = ["inbox", "active", "waiting", "someday", "done"] as const;
export type BoardLifecycle = (typeof BOARD_LIFECYCLES)[number];

export function isBoardLifecycle(value: string): value is BoardLifecycle {
  return (BOARD_LIFECYCLES as readonly string[]).includes(value);
}
