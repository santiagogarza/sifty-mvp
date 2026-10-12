import { EXECUTION_STATUSES, type ExecutionStatus } from "@/lib/domain/types";
import {
  EXECUTION_TRANSITIONS,
  IllegalTransitionError,
  assertTransition,
  canTransition,
  isTerminal,
  isWaiting,
  sourcesOf,
} from "@/lib/executions/state";
import { describe, expect, it } from "vitest";

/**
 * The state machine as the plan specifies it:
 * `queued → running → needs_decision | needs_approval | drafted → done | failed | cancelled`.
 */
const ALLOWED: ReadonlyArray<[ExecutionStatus, ExecutionStatus]> = [
  ["queued", "running"],
  ["queued", "needs_approval"],
  ["queued", "failed"],
  ["queued", "cancelled"],
  ["needs_approval", "running"],
  ["needs_approval", "cancelled"],
  ["running", "done"],
  ["running", "failed"],
  ["running", "cancelled"],
  ["running", "drafted"],
  ["running", "needs_decision"],
  ["needs_decision", "running"],
  ["needs_decision", "cancelled"],
  ["drafted", "done"],
  ["drafted", "cancelled"],
];

describe("execution state machine", () => {
  it("allows exactly the documented transitions", () => {
    const allowed = new Set(ALLOWED.map(([a, b]) => `${a}>${b}`));
    for (const from of EXECUTION_STATUSES) {
      for (const to of EXECUTION_STATUSES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("terminal statuses have no exits and every status is reachable", () => {
    for (const status of ["done", "failed", "cancelled"] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(EXECUTION_TRANSITIONS[status]).toEqual([]);
    }
    for (const status of EXECUTION_STATUSES) {
      if (status === "queued") continue;
      expect(sourcesOf(status).length, `${status} is reachable`).toBeGreaterThan(0);
    }
    expect(sourcesOf("queued")).toEqual([]);
    expect(sourcesOf("cancelled").sort()).toEqual(
      ["drafted", "needs_approval", "needs_decision", "queued", "running"].sort(),
    );
  });

  it("waiting statuses are the three that hold no slot", () => {
    expect(EXECUTION_STATUSES.filter(isWaiting)).toEqual([
      "needs_decision",
      "needs_approval",
      "drafted",
    ]);
  });

  it("assertTransition throws a typed error for an illegal move", () => {
    expect(() => assertTransition("done", "running")).toThrow(IllegalTransitionError);
    expect(() => assertTransition("drafted", "running")).toThrow(/drafted to running/);
    expect(() => assertTransition("queued", "running")).not.toThrow();
  });
});
