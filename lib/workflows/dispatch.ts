import { getRun, resumeHook, start } from "workflow/api";
import { HookNotFoundError } from "workflow/errors";

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

/**
 * `not_found`: no run is suspended on that token (it was never registered,
 * the run ended, or the hook was disposed). The caller decides what that
 * means — for a decision, "re-run instead of resume".
 */
export type ResumeOutcome = { ok: true; runId: string } | { ok: false; reason: "not_found" };

export interface WorkflowClient {
  // biome-ignore lint/suspicious/noExplicitAny: see WorkflowFn.
  start<TArgs extends any[]>(workflow: WorkflowFn<TArgs>, args: TArgs): Promise<StartedRun>;
  /** Resolve with the run's result, or `pending` once `timeoutMs` elapses. */
  wait(runId: string, timeoutMs: number): Promise<RunOutcome>;
  /** Deliver `payload` to the run suspended on hook `token`. */
  resume(token: string, payload: unknown): Promise<ResumeOutcome>;
}

const realClient: WorkflowClient = {
  async start(workflow, args) {
    const run = await start(workflow, args);
    return { runId: run.runId };
  },
  async resume(token, payload) {
    try {
      const hook = await resumeHook(token, payload);
      return { ok: true, runId: hook.runId };
    } catch (err) {
      if (HookNotFoundError.is(err)) return { ok: false, reason: "not_found" };
      throw err;
    }
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

export function resumeWorkflowHook(token: string, payload: unknown): Promise<ResumeOutcome> {
  return (_override ?? realClient).resume(token, payload);
}
