import type { Repos } from "@/lib/db/repos";
import type { TaskEventKind, TaskEventRecord } from "@/lib/db/repos/types";
import type { Execution } from "@/lib/domain/types";

/**
 * Audit trail for executions, in `task_events` next to the daily plan's
 * moves. One row per status change, with a human-readable `reason`, so
 * the task sheet can tell the story ("Sifty drafted notes · you approved
 * them · done") without reading the execution log.
 *
 * Ids are derived from the execution and the event, so a retried workflow
 * step appends each event once. Events that may legitimately recur
 * (`needs_decision`, `approved`) pass a discriminator.
 */
export type ExecutionEventKind = Extract<TaskEventKind, `execution.${string}`>;

export async function recordExecutionEvent(
  repos: Repos,
  userId: string,
  execution: Pick<Execution, "id" | "taskId" | "executor" | "policy">,
  kind: ExecutionEventKind,
  payload: Record<string, unknown> = {},
  discriminator?: string | number,
): Promise<TaskEventRecord> {
  const suffix = discriminator === undefined ? "" : `:${discriminator}`;
  return repos.taskEvents.append(userId, {
    id: `evt_${execution.id}:${kind}${suffix}`,
    taskId: execution.taskId,
    kind,
    payload: {
      executionId: execution.id,
      executor: execution.executor,
      policy: execution.policy,
      ...payload,
    },
  });
}
