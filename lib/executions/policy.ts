import type { Repos } from "@/lib/db/repos";
import type { ExecutionPolicy } from "@/lib/domain/types";

/**
 * Which human gate an execution gets (decision D9).
 *
 * Resolution order, most specific first:
 *
 *   1. an explicit choice on this request (the "Run now" picker);
 *   2. the task's saved policy (`execution_policies`, scope `task`);
 *   3. the connector's saved policy (scope `connector`), when the executor
 *      needs one;
 *   4. the default: `draft_then_approve`.
 *
 * Then the hard rule: `auto` is honoured only for read-only executors.
 * Anything that can have a side effect is downgraded to
 * `draft_then_approve` no matter who asked for `auto`, and the caller is
 * told (`downgraded`) so the UI can say so instead of silently ignoring a
 * setting.
 */

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = "draft_then_approve";

export interface PolicyResolution {
  policy: ExecutionPolicy;
  /** Where the winning policy came from. */
  source: "request" | "task" | "connector" | "default";
  /** Set when `auto` was asked for but the executor is not read-only. */
  downgraded: { from: "auto"; to: "draft_then_approve" } | null;
}

export function applyReadOnlyRule(
  requested: ExecutionPolicy,
  executor: { readOnly: boolean },
): Pick<PolicyResolution, "policy" | "downgraded"> {
  if (requested === "auto" && !executor.readOnly) {
    return { policy: "draft_then_approve", downgraded: { from: "auto", to: "draft_then_approve" } };
  }
  return { policy: requested, downgraded: null };
}

export async function resolveExecutionPolicy(
  repos: Repos,
  userId: string,
  input: {
    taskId: string;
    connector: string | null;
    executor: { readOnly: boolean };
    requested?: ExecutionPolicy | null;
  },
): Promise<PolicyResolution> {
  const pick = async (): Promise<Pick<PolicyResolution, "policy" | "source">> => {
    if (input.requested) return { policy: input.requested, source: "request" };
    const task = await repos.executionPolicies.get(userId, "task", input.taskId);
    if (task) return { policy: task.policy, source: "task" };
    if (input.connector) {
      const connector = await repos.executionPolicies.get(userId, "connector", input.connector);
      if (connector) return { policy: connector.policy, source: "connector" };
    }
    return { policy: DEFAULT_EXECUTION_POLICY, source: "default" };
  };
  const picked = await pick();
  return { ...applyReadOnlyRule(picked.policy, input.executor), source: picked.source };
}
