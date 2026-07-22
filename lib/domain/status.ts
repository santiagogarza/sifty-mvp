import type { Lifecycle } from "./types";

/**
 * Status presentation — the single source of truth for how each stored
 * `Lifecycle` value is shown to the user.
 *
 * The stored enum (`inbox | active | waiting | someday | done | dropped`)
 * is a wire/DB contract and never changes shape. Everything user-facing —
 * the sidebar, the Status picker in the task sheet, the filing strip, and
 * a future Kanban board — reads labels, descriptions, order, and routes
 * from this map so the vocabulary can never drift between surfaces.
 *
 * Notable mapping: the stored value `active` is presented as "Focus", the
 * same word as the sidebar view, so moving a task to Focus visibly lands
 * it in Focus.
 */

export interface StatusMeta {
  label: string;
  /** One-line meaning, shown in the Status picker. */
  description: string;
  /** Pipeline order: sidebar order and future Kanban column order. */
  order: number;
  /** View route for this status, or null when it has no page (dropped). */
  href: string | null;
}

export const STATUS_META: Record<Lifecycle, StatusMeta> = {
  inbox: {
    label: "Inbox",
    description: "New — not yet sorted",
    order: 0,
    href: "/inbox",
  },
  active: {
    label: "Focus",
    description: "Committed — working on it",
    order: 1,
    href: "/focus",
  },
  waiting: {
    label: "Waiting on",
    description: "Handed off — the ball is with someone else",
    order: 2,
    href: "/waiting",
  },
  someday: {
    label: "Someday",
    description: "Not now, maybe later",
    order: 3,
    href: "/someday",
  },
  done: {
    label: "Done",
    description: "Finished",
    order: 4,
    href: "/done",
  },
  dropped: {
    label: "Dropped",
    description: "Let go — kept for reference",
    order: 5,
    href: null,
  },
};

/** All statuses in pipeline order — the sidebar and future Kanban columns. */
export const STATUSES_IN_ORDER: readonly Lifecycle[] = (
  Object.keys(STATUS_META) as Lifecycle[]
).sort((a, b) => STATUS_META[a].order - STATUS_META[b].order);

export function statusLabel(status: Lifecycle): string {
  return STATUS_META[status].label;
}
