"use client";

import type { Execution, ExecutionPolicy, ExecutionStep } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { id as makeId } from "@/lib/utils/ids";
import { create } from "zustand";
import { isTerminal } from "./state";

/**
 * Client view of a task's executions, for the detail sheet.
 *
 * Executions are server-owned (a workflow moves them), so like decisions
 * this is a cache, not an optimistic store: `GET /api/tasks/:id/executions`
 * per task, polled while one is in flight, refreshed when an answer in the
 * Decisions inbox moves one (`sifty:execution-changed`).
 */

export interface TaskExecutions {
  executions: Execution[];
  /** Step log of the newest execution. */
  steps: ExecutionStep[];
  loaded: boolean;
  error: string | null;
}

export type StartOutcome =
  | { ok: true; execution: Execution; created: boolean }
  | { ok: false; status: number; code: string | null; error: string; execution: Execution | null };

interface ExecutionsState {
  byTask: Record<string, TaskExecutions>;
  refresh: (taskId: string) => Promise<TaskExecutions | null>;
  start: (
    taskId: string,
    opts: { policy?: ExecutionPolicy | null; idempotencyKey?: string },
  ) => Promise<StartOutcome>;
  cancel: (
    taskId: string,
    executionId: string,
  ) => Promise<{ ok: true; execution: Execution } | { ok: false; error: string }>;
  /** Replace one execution in the cache (an answer's response, a poll). */
  adopt: (execution: Execution, steps?: ExecutionStep[]) => void;
}

const EMPTY: TaskExecutions = { executions: [], steps: [], loaded: false, error: null };

export const useExecutionsStore = create<ExecutionsState>()((set, get) => ({
  byTask: {},

  async refresh(taskId) {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/executions`, {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 404) {
        const next = { ...EMPTY, loaded: true };
        set((s) => ({ byTask: { ...s.byTask, [taskId]: next } }));
        return next;
      }
      if (!res.ok) throw new Error(`executions ${res.status}`);
      const body = (await res.json()) as { executions: Execution[]; steps: ExecutionStep[] };
      const next: TaskExecutions = {
        executions: body.executions,
        steps: body.steps,
        loaded: true,
        error: null,
      };
      set((s) => ({ byTask: { ...s.byTask, [taskId]: next } }));
      return next;
    } catch (err) {
      const prev = get().byTask[taskId] ?? EMPTY;
      const next = {
        ...prev,
        loaded: true,
        error: err instanceof Error ? err.message : "Could not load",
      };
      set((s) => ({ byTask: { ...s.byTask, [taskId]: next } }));
      return null;
    }
  },

  async start(taskId, opts) {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/execute`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        policy: opts.policy ?? undefined,
        idempotencyKey: opts.idempotencyKey ?? makeId("run"),
        modelPreference: useStore.getState().modelPreference,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      execution?: Execution | null;
      created?: boolean;
      error?: string;
      code?: string;
    } | null;
    if (!res.ok || !body?.execution) {
      return {
        ok: false,
        status: res.status,
        code: body?.code ?? null,
        error: body?.error ?? `Could not start (${res.status})`,
        execution: body?.execution ?? null,
      };
    }
    get().adopt(body.execution, []);
    return { ok: true, execution: body.execution, created: body.created ?? true };
  },

  async cancel(_taskId, executionId) {
    const res = await fetch(`/api/executions/${encodeURIComponent(executionId)}/cancel`, {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      execution?: Execution;
      error?: string;
    } | null;
    if (!res.ok || !body?.execution) {
      return { ok: false, error: body?.error ?? `Could not stop (${res.status})` };
    }
    get().adopt(body.execution);
    return { ok: true, execution: body.execution };
  },

  adopt(execution, steps) {
    set((s) => {
      const prev = s.byTask[execution.taskId] ?? EMPTY;
      const others = prev.executions.filter((e) => e.id !== execution.id);
      const executions = [execution, ...others].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      const newest = executions[0];
      return {
        byTask: {
          ...s.byTask,
          [execution.taskId]: {
            executions,
            steps: newest?.id === execution.id && steps ? steps : prev.steps,
            loaded: true,
            error: null,
          },
        },
      };
    });
  },
}));

const POLL_MS = 1500;
const POLL_MAX_MS = 5 * 60 * 1000;
const watching = new Map<string, number>();

/**
 * Poll one execution until it is terminal or parked on a decision, for
 * at most five minutes. A second call for the same id is a no-op.
 */
export function watchExecution(executionId: string): void {
  if (typeof window === "undefined" || watching.has(executionId)) return;
  const started = Date.now();
  const tick = async () => {
    try {
      const res = await fetch(`/api/executions/${encodeURIComponent(executionId)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json()) as { execution: Execution; steps: ExecutionStep[] };
        useExecutionsStore.getState().adopt(body.execution, body.steps);
        if (isTerminal(body.execution.status) || body.execution.decisionId) {
          watching.delete(executionId);
          return;
        }
      } else if (res.status === 404) {
        watching.delete(executionId);
        return;
      }
    } catch {
      // Transient; try again on the next tick.
    }
    if (Date.now() - started > POLL_MAX_MS) {
      watching.delete(executionId);
      return;
    }
    watching.set(
      executionId,
      window.setTimeout(() => void tick(), POLL_MS),
    );
  };
  watching.set(
    executionId,
    window.setTimeout(() => void tick(), POLL_MS),
  );
}

/** Whether the newest execution of a task is still moving (poll-worthy). */
export function isLive(execution: Execution | undefined): boolean {
  return !!execution && !isTerminal(execution.status) && !execution.decisionId;
}

export function selectTaskExecutions(state: ExecutionsState, taskId: string): TaskExecutions {
  return state.byTask[taskId] ?? EMPTY;
}
