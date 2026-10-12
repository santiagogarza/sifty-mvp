import type { ExecutionStatus } from "@/lib/domain/types";

/**
 * The execution state machine, as data.
 *
 *   queued ──────────► running ──► done
 *     │                  │  ▲  └──► failed
 *     ├► needs_approval ─┘  │  └──► drafted ──► done
 *     │        │            │          │
 *     │        └────────────┼──────────┼──► cancelled
 *     │                     │          │
 *     └► cancelled   running ► needs_decision ──┘ (→ running | cancelled)
 *
 * Every write that changes `status` goes through `ExecutionRepo.transition`
 * with a `from` list taken from here, so an illegal move is a no-op in the
 * database rather than a corrupted row. `assertTransition` is for callers
 * that want the error instead.
 */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> =
  {
    queued: ["running", "needs_approval", "failed", "cancelled"],
    needs_approval: ["running", "cancelled"],
    running: ["done", "failed", "cancelled", "drafted", "needs_decision"],
    needs_decision: ["running", "cancelled"],
    drafted: ["done", "cancelled"],
    done: [],
    failed: [],
    cancelled: [],
  };

export const TERMINAL_STATUSES: readonly ExecutionStatus[] = ["done", "failed", "cancelled"];

/** Statuses in which a run is suspended on a decision and holds no slot. */
export const WAITING_STATUSES: readonly ExecutionStatus[] = [
  "needs_approval",
  "needs_decision",
  "drafted",
];

export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isWaiting(status: ExecutionStatus): boolean {
  return WAITING_STATUSES.includes(status);
}

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

/** Every status that may move to `to`; the `from` list for a CAS transition. */
export function sourcesOf(to: ExecutionStatus): ExecutionStatus[] {
  return (Object.keys(EXECUTION_TRANSITIONS) as ExecutionStatus[]).filter((from) =>
    EXECUTION_TRANSITIONS[from].includes(to),
  );
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: ExecutionStatus,
    readonly to: ExecutionStatus,
  ) {
    super(`Execution cannot move from ${from} to ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Short labels for the task sheet and the inbox. */
export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  queued: "Queued",
  running: "Working",
  needs_decision: "Has a question",
  needs_approval: "Waiting for your go-ahead",
  drafted: "Draft ready",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
