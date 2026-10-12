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
  /**
   * Fetch the inbox. Resolves with a fetch that *started after this call*
   * (a request already in flight is awaited, then a fresh one runs), so a
   * caller that needs "the server's view as of now" can trust `ok: true`.
   */
  refresh: () => Promise<{ ok: boolean }>;
  answer: (
    id: string,
    answer: Pick<DecisionAnswer, "text" | "option">,
  ) => Promise<{ ok: true; mode: string } | { ok: false; error: string }>;
  dismiss: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

let inFlight: Promise<{ ok: boolean }> | null = null;
/**
 * Decisions resolved from this client and not yet confirmed gone by a
 * fetch that started after the resolution. A `GET` that was already in
 * flight when the user answered still carries the item; without this it
 * would put the answered question back in the inbox for a moment.
 */
const resolvedLocally = new Set<string>();
let mutationSeq = 0;

export const useDecisionsStore = create<DecisionsState>()((set, get) => ({
  decisions: [],
  tasks: {},
  count: 0,
  loaded: false,
  error: null,

  async refresh() {
    // Never hand a caller a response older than its request: wait out the
    // in-flight fetch, then run one of our own.
    while (inFlight) await inFlight;
    const run = (async (): Promise<{ ok: boolean }> => {
      try {
        const seqAtStart = mutationSeq;
        const res = await fetch("/api/decisions", { credentials: "include" });
        if (res.status === 401) {
          set({ decisions: [], tasks: {}, count: 0, loaded: true, error: null });
          return { ok: true };
        }
        if (!res.ok) throw new Error(`decisions ${res.status}`);
        const body = (await res.json()) as DecisionsResponse;
        // A response that predates a local resolution may still list the
        // resolved item; a fetch started after it is the first that can
        // vouch the server agrees.
        if (seqAtStart === mutationSeq) resolvedLocally.clear();
        const decisions = body.decisions.filter((d) => !resolvedLocally.has(d.id));
        set({
          decisions,
          tasks: Object.fromEntries(body.tasks.map((t) => [t.id, t])),
          count: Math.max(0, body.count - (body.decisions.length - decisions.length)),
          loaded: true,
          error: null,
        });
        return { ok: true };
      } catch (err) {
        set({ loaded: true, error: err instanceof Error ? err.message : "Could not load" });
        return { ok: false };
      } finally {
        inFlight = null;
      }
    })();
    inFlight = run;
    return run;
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
  mutationSeq += 1;
  resolvedLocally.add(id);
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
