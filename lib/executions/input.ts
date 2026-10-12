/**
 * The contract between an execution and the `executeTask` workflow run.
 * Dependency-free on purpose: the workflow bundle imports this, the service
 * and the routes import this, and neither drags the other's runtime along.
 */

export interface ExecutionInput {
  userId: string;
  executionId: string;
  taskId: string;
  offline: boolean;
  modelPreference: string | null;
}

/** At most this many executions run at once per account. */
export const EXECUTION_SLOTS_PER_USER = 1;
