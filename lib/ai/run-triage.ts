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
/** Re-sift requests in progress, so a double click cannot burn two sifts. */
const resifting = new Set<string>();
/**
 * The sift a watcher must see before it may settle: set while a re-sift
 * request is in flight (`"pending"`), then the `siftId` the server
 * answered with. A poll that still shows the superseded run (another
 * `siftId`, possibly already `ready`) is skipped, not adopted.
 */
const expectedSift = new Map<string, string>();

export function isTriageInFlight(taskId: string): boolean {
  return inFlight.has(taskId) || resifting.has(taskId);
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

    let deadline = Date.now() + WATCH_TIMEOUT_MS;
    let delay = POLL_MS;
    let awaiting = expectedSift.get(taskId);
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
        const expected = expectedSift.get(taskId);
        if (expected !== awaiting) {
          // A re-sift started while this watcher was running: re-arm.
          awaiting = expected;
          deadline = Date.now() + WATCH_TIMEOUT_MS;
          delay = POLL_MS;
        }
        if (awaiting && data.task.siftId !== awaiting) {
          // Still the superseded run (or the re-sift has not landed yet).
          await sleep(delay);
          continue;
        }
        await adopt(data);
        if (settled(data.task.aiStatus)) {
          // `adopt` may have awaited a push; a re-sift that started in the
          // meantime must not be wiped by this (now stale) snapshot.
          if (expectedSift.get(taskId) !== awaiting) continue;
          expectedSift.delete(taskId);
          return;
        }
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
  if (!task || resifting.has(taskId)) return;

  resifting.add(taskId);
  // Until the server answers, no watcher may settle on a poll result.
  expectedSift.set(taskId, "pending");
  store.patchTaskFromServer(taskId, { aiStatus: "pending", aiError: null, siftStage: null });
  try {
    await getSyncHooks()?.waitForTask(taskId);
    const res = await fetch("/api/triage", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, modelPreference: useStore.getState().modelPreference }),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { siftId?: string } | null;
      if (body?.siftId) expectedSift.set(taskId, body.siftId);
      else expectedSift.delete(taskId);
    } else {
      expectedSift.delete(taskId);
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        task?: Task;
      } | null;
      if (body?.task) {
        // The server marked the task (cap, could not start). Adopt it the
        // same way a poll result is adopted: never over unpushed edits.
        await adopt({ task: body.task, labels: [] });
      } else {
        useStore.getState().patchTaskFromServer(taskId, {
          aiStatus: "failed",
          aiError: body?.error || `Sifting failed (${res.status})`,
        });
      }
      return;
    }
  } catch (err) {
    expectedSift.delete(taskId);
    useStore.getState().patchTaskFromServer(taskId, {
      aiStatus: "failed",
      aiError: err instanceof Error ? err.message : "Sifting failed",
    });
    return;
  } finally {
    resifting.delete(taskId);
  }
  // A watcher already running re-arms on the new expectation; otherwise start one.
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
