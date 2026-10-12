"use client";

import type { Label, Task } from "@/lib/domain/types";
import { getSyncHooks, useStore } from "@/lib/store/store";

/**
 * Client-side companion of the server-side sift.
 *
 * Sifting runs in the `siftTask` workflow: `POST /api/tasks` enqueues it
 * when a capture lands, `POST /api/triage` re-runs it on demand. The
 * browser's only job is to *watch*: poll `GET /api/tasks/:id` until the
 * task leaves `pending`/`running`, adopting each stage's result as it
 * lands so the row and the detail sheet show "Enriching → Prioritizing →
 * …" without a socket.
 *
 * Local edits win: while the task has unpushed changes only the AI
 * bookkeeping fields (`aiStatus`, `siftStage`, `aiError`) are adopted; the
 * full server task replaces the local one once the push settles. The
 * server applied the stage with the same `editedFields` protection, so
 * both sides converge.
 */

const inFlight = new Set<string>();

export function isTriageInFlight(taskId: string): boolean {
  return inFlight.has(taskId);
}

const POLL_MS = 1200;
const POLL_MAX_MS = 3000;
/** Five model calls on a slow day plus queue latency; past this we stop and say so. */
const WATCH_TIMEOUT_MS = 120_000;
export const SIFT_TIMEOUT_MESSAGE = "Sifting is taking longer than expected — try again.";

interface TaskResponse {
  task: Task;
  labels: Label[];
}

function settled(status: Task["aiStatus"]): boolean {
  return status === "ready" || status === "failed" || status === "idle";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Follow the sift of `taskId` until it settles. Safe to call more than once;
 * concurrent calls for the same task coalesce.
 */
export async function watchSift(taskId: string): Promise<void> {
  if (inFlight.has(taskId)) return;
  const local = useStore.getState().tasks.find((t) => t.id === taskId);
  if (!local) return;
  inFlight.add(taskId);
  try {
    // Let the create push land first: the server enqueues the sift in that
    // response, and until then there is nothing to poll.
    await getSyncHooks()?.waitForTask(taskId);

    const deadline = Date.now() + WATCH_TIMEOUT_MS;
    let delay = POLL_MS;
    while (Date.now() < deadline) {
      if (!useStore.getState().tasks.some((t) => t.id === taskId)) return;
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        credentials: "include",
      });
      // 404: the create never reached the server (offline capture); the
      // sync replay will enqueue it and start a new watch. 401: signed out.
      if (res.status === 404 || res.status === 401) return;
      if (res.ok) {
        const data = (await res.json()) as TaskResponse;
        await adopt(data);
        if (settled(data.task.aiStatus)) return;
      }
      await sleep(delay);
      delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.25));
    }
    useStore.getState().patchTaskFromServer(taskId, {
      aiStatus: "failed",
      aiError: SIFT_TIMEOUT_MESSAGE,
    });
  } catch {
    // Network blip: the next mount's pull or resume sweep picks it up.
  } finally {
    inFlight.delete(taskId);
  }
}

/** "Re-sift now": ask the server to run the pipeline again, then watch it. */
export async function resiftTask(taskId: string): Promise<void> {
  const store = useStore.getState();
  const task = store.tasks.find((t) => t.id === taskId);
  if (!task || inFlight.has(taskId)) return;

  store.patchTaskFromServer(taskId, { aiStatus: "pending", aiError: null, siftStage: null });
  try {
    await getSyncHooks()?.waitForTask(taskId);
    const res = await fetch("/api/triage", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, modelPreference: useStore.getState().modelPreference }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        task?: Task;
      } | null;
      if (body?.task) {
        useStore.getState().replaceTaskFromServer(body.task);
      } else {
        useStore.getState().patchTaskFromServer(taskId, {
          aiStatus: "failed",
          aiError: body?.error || `Sifting failed (${res.status})`,
        });
      }
      return;
    }
  } catch (err) {
    useStore.getState().patchTaskFromServer(taskId, {
      aiStatus: "failed",
      aiError: err instanceof Error ? err.message : "Sifting failed",
    });
    return;
  }
  await watchSift(taskId);
}

async function adopt(data: TaskResponse): Promise<void> {
  const store = useStore.getState();
  const dirty = getSyncHooks()?.isTaskDirty(data.task.id) ?? false;
  if (!dirty) {
    store.upsertLabels(data.labels);
    store.replaceTaskFromServer(data.task);
    return;
  }
  // Unpushed local edits: adopt only what the server owns outright. The
  // settled snapshot is adopted in full once the push drains.
  store.patchTaskFromServer(data.task.id, {
    aiStatus: data.task.aiStatus,
    aiError: data.task.aiError,
    siftStage: data.task.siftStage,
  });
  if (settled(data.task.aiStatus)) {
    await getSyncHooks()?.waitForTask(data.task.id);
    if (!(getSyncHooks()?.isTaskDirty(data.task.id) ?? false)) {
      const res = await fetch(`/api/tasks/${encodeURIComponent(data.task.id)}`, {
        credentials: "include",
      });
      if (res.ok) {
        const fresh = (await res.json()) as TaskResponse;
        const s = useStore.getState();
        s.upsertLabels(fresh.labels);
        s.replaceTaskFromServer(fresh.task);
      }
    }
  }
}
