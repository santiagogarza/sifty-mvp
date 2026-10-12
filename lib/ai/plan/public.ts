import type { DailyPlanMoveKind, DailyPlanRecord } from "@/lib/db/repos/types";

/** "Moved into Today: due tomorrow, high importance". */
export function describeMove(kind: DailyPlanMoveKind, reason: string): string {
  const label =
    kind === "moved_in"
      ? "Moved into Today"
      : kind === "moved_out"
        ? "Moved out of Today"
        : "Re-ranked";
  return reason ? `${label}: ${reason}` : label;
}

/** The plan as the client sees it: no tenant id, no workflow bookkeeping. */
export type PublicDailyPlan = Omit<DailyPlanRecord, "userId" | "workflowRunId" | "aiRunId">;

export function publicPlan(plan: DailyPlanRecord): PublicDailyPlan {
  const { userId: _u, workflowRunId: _w, aiRunId: _a, ...rest } = plan;
  return rest;
}
