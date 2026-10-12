"use client";

import { watchSift } from "@/lib/ai/run-triage";
import type { Decision, DecisionAnswer, Task } from "@/lib/domain/types";
import { useStore } from "@/lib/store/store";
import { create } from "zustand";

/**
 * Client view of the Decisions inbox.
 *
 * Decisions are server-owned (a workflow opens them, the user resolves
 * them once), so unlike tasks they are not optimistic or persisted: this
 * is a cache of `GET /api/decisions` plus the two mutations. Refreshed on
 * mount, when the window regains focus, when a sift settles (the moment a
 * question can appear), and after every answer or dismiss.
 */

/** The task fields the inbox renders next to a question. */
export interface DecisionTaskSummary {
  id: string;
  title: string;
  sourceText: string;
  lifecycle: Task["lifecycle"];
}

export interface DecisionsResponse {
  decisions: Decision[];
  tasks: DecisionTaskSummary[];
  count: number;
}

interface DecisionsState {
  decisions: Decision[];
  tasks: Record<string, DecisionTaskSummary>;
  /** Open count; also what the nav badge shows. */
  count: number;
  /** First fetch has settled (ok or not). */
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  answer: (
    id: string,
    answer: Pick<DecisionAnswer, "text" | "option">,
  ) => Promise<{ ok: true; mode: string } | { ok: false; error: string }>;
  dismiss: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

let inFlight: Promise<void> | null = null;

export const useDecisionsStore = create<DecisionsState>()((set, get) => ({
  decisions: [],
  tasks: {},
  count: 0,
  loaded: false,
  error: null,

  async refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await fetch("/api/decisions", { credentials: "include" });
        if (res.status === 401) {
          set({ decisions: [], tasks: {}, count: 0, loaded: true, error: null });
          return;
        }
        if (!res.ok) throw new Error(`decisions ${res.status}`);
        const body = (await res.json()) as DecisionsResponse;
        set({
          decisions: body.decisions,
          tasks: Object.fromEntries(body.tasks.map((t) => [t.id, t])),
          count: body.count,
          loaded: true,
          error: null,
        });
      } catch (err) {
        set({ loaded: true, error: err instanceof Error ? err.message : "Could not load" });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  async answer(id, answer) {
    const res = await fetch(`/api/decisions/${encodeURIComponent(id)}/answer`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: answer.text ?? undefined,
        option: answer.option ?? undefined,
        modelPreference: useStore.getState().modelPreference,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      mode?: string;
      task?: Task | null;
    } | null;
    if (!res.ok) {
      // 409: someone (another tab, a link) got there first — drop it locally.
      if (res.status === 409 || res.status === 404) removeLocally(set, get, id);
      return { ok: false, error: body?.error ?? `Could not answer (${res.status})` };
    }
    removeLocally(set, get, id);
    adoptTask(body?.task ?? null);
    return { ok: true, mode: body?.mode ?? "recorded" };
  },

  async dismiss(id) {
    const res = await fetch(`/api/decisions/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      task?: Task | null;
    } | null;
    if (!res.ok) {
      if (res.status === 409 || res.status === 404) removeLocally(set, get, id);
      return { ok: false, error: body?.error ?? `Could not dismiss (${res.status})` };
    }
    removeLocally(set, get, id);
    adoptTask(body?.task ?? null);
    return { ok: true };
  },
}));

function removeLocally(
  set: (partial: Partial<DecisionsState>) => void,
  get: () => DecisionsState,
  id: string,
): void {
  const { decisions, count } = get();
  if (!decisions.some((d) => d.id === id)) return;
  set({ decisions: decisions.filter((d) => d.id !== id), count: Math.max(0, count - 1) });
}

/**
 * The server's task after an answer/dismiss: adopt the AI bookkeeping and
 * follow the sift if one is running, so the task row shows the second pass.
 */
function adoptTask(task: Task | null): void {
  if (!task) return;
  const store = useStore.getState();
  if (!store.tasks.some((t) => t.id === task.id)) return;
  store.patchTaskFromServer(task.id, {
    aiStatus: task.aiStatus,
    aiError: task.aiError,
    siftStage: task.siftStage,
    clarifyingQuestion: task.clarifyingQuestion,
    siftedWithAssumptions: task.siftedWithAssumptions,
  });
  if (task.aiStatus === "pending" || task.aiStatus === "running") void watchSift(task.id);
}

/** Open decisions about one task, for the detail sheet. */
export function selectOpenForTask(state: DecisionsState, taskId: string): Decision[] {
  return state.decisions.filter((d) => d.taskId === taskId);
}
