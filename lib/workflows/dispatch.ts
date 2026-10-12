import { getRun, start } from "workflow/api";

/**
 * The one place that talks to Workflow's client API (`workflow/api`).
 *
 * Routes enqueue through `startWorkflow()` so tests can swap the client
 * (`setWorkflowClientForTesting`) the same way they swap repos and the
 * email provider: route tests assert *that* a workflow was enqueued with
 * which input, without a Workflow world running.
 *
 * In production the Vercel World is selected automatically; locally the
 * Local World runs inside `next dev` / `next start` (see README →
 * "Background jobs").
 */

// biome-ignore lint/suspicious/noExplicitAny: mirrors Workflow's own `start()` generic.
export type WorkflowFn<TArgs extends any[]> = (...args: TArgs) => Promise<unknown>;

export interface StartedRun {
  runId: string;
}

export type RunOutcome =
  | { status: "completed"; value: unknown }
  | { status: "failed"; error: string }
  | { status: "pending" };

export interface WorkflowClient {
  // biome-ignore lint/suspicious/noExplicitAny: see WorkflowFn.
  start<TArgs extends any[]>(workflow: WorkflowFn<TArgs>, args: TArgs): Promise<StartedRun>;
  /** Resolve with the run's result, or `pending` once `timeoutMs` elapses. */
  wait(runId: string, timeoutMs: number): Promise<RunOutcome>;
}

const realClient: WorkflowClient = {
  async start(workflow, args) {
    const run = await start(workflow, args);
    return { runId: run.runId };
  },
  async wait(runId, timeoutMs) {
    const run = getRun(runId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<RunOutcome>((resolve) => {
      timer = setTimeout(() => resolve({ status: "pending" }), timeoutMs);
    });
    const outcome = run.returnValue.then(
      (value): RunOutcome => ({ status: "completed", value }),
      (err): RunOutcome => ({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    try {
      return await Promise.race([outcome, timeout]);
    } finally {
      clearTimeout(timer);
    }
  },
};

let _override: WorkflowClient | null = null;

export function setWorkflowClientForTesting(client: WorkflowClient | null): void {
  _override = client;
}

// biome-ignore lint/suspicious/noExplicitAny: see WorkflowFn.
export function startWorkflow<TArgs extends any[]>(
  workflow: WorkflowFn<TArgs>,
  args: TArgs,
): Promise<StartedRun> {
  return (_override ?? realClient).start(workflow, args);
}

export function waitForRun(runId: string, timeoutMs: number): Promise<RunOutcome> {
  return (_override ?? realClient).wait(runId, timeoutMs);
}
