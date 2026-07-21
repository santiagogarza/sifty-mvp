"use client";

import { isTriageInFlight, runTriage } from "@/lib/ai/run-triage";
import type { Label, Memory, Task } from "@/lib/domain/types";
import * as React from "react";
import { type SyncHooks, registerSyncHooks, useStore } from "./store";

/**
 * Server sync.
 *
 * The store is the optimistic source of truth for the UI; the server is the
 * durable source of truth across devices. This module bridges them:
 *
 * 1. **Push.** Every store mutation notifies this module (via the
 *    `SyncHooks` registered into the store). Creates and deletes push
 *    immediately; field edits are debounced per entity and always send the
 *    full entity (last-writer-wins). Pushes for one entity are chained so
 *    they can never arrive out of order.
 *
 * 2. **Dirty ledger.** Before an entity is pushed it is marked dirty in
 *    localStorage (with tombstones for deletes). A push that never lands —
 *    tab closed, network down — leaves the mark, and the next mount
 *    replays it. On overlap, dirty-local wins over server; clean-local
 *    yields to server.
 *
 * 3. **Pull.** On mount, `useServerSync` fetches the server snapshot and
 *    reconciles it into the store using the ledger. It also detects an
 *    account switch (shared browser) and resets the local cache instead of
 *    replaying the previous user's data into the new account.
 *
 * 4. **Triage recovery.** Tasks stuck in `pending`/`running` from an
 *    interrupted session are re-triaged (bounded) after reconcile.
 *
 * Failures are logged, never thrown into the UI: the app keeps working
 * locally and converges when the network returns.
 */

const LEDGER_KEY = "sifty-sync-ledger-v1";
const PATCH_DEBOUNCE_MS = 400;
const AUTO_RESUME_LIMIT = 3;

type EntityKind = "tasks" | "memories" | "labels";

interface Ledger {
  lastUserId: string | null;
  dirty: Record<EntityKind, string[]>;
  deleted: { tasks: string[]; memories: string[] };
}

function emptyLedger(): Ledger {
  return {
    lastUserId: null,
    dirty: { tasks: [], memories: [], labels: [] },
    deleted: { tasks: [], memories: [] },
  };
}

function loadLedger(): Ledger | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    return {
      lastUserId: parsed.lastUserId ?? null,
      dirty: {
        tasks: parsed.dirty?.tasks ?? [],
        memories: parsed.dirty?.memories ?? [],
        labels: parsed.dirty?.labels ?? [],
      },
      deleted: {
        tasks: parsed.deleted?.tasks ?? [],
        memories: parsed.deleted?.memories ?? [],
      },
    };
  } catch {
    return null;
  }
}

// Load eagerly so a capture that happens before the first pull lands in
// the persisted ledger instead of overwriting it with an empty one.
const persistedAtBoot = loadLedger();
let ledger: Ledger = persistedAtBoot ?? emptyLedger();
/** False on the very first run of a sync-aware build in this browser. */
const ledgerExistedAtBoot = persistedAtBoot !== null;

function saveLedger(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // Quota/private-mode failures degrade to session-only tracking.
  }
}

function markDirty(kind: EntityKind, id: string): void {
  if (!ledger.dirty[kind].includes(id)) {
    ledger.dirty[kind].push(id);
    saveLedger();
  }
}

function clearDirty(kind: EntityKind, id: string): void {
  const idx = ledger.dirty[kind].indexOf(id);
  if (idx >= 0) {
    ledger.dirty[kind].splice(idx, 1);
    saveLedger();
  }
}

function isDirty(kind: EntityKind, id: string): boolean {
  return ledger.dirty[kind].includes(id);
}

function addTombstone(kind: "tasks" | "memories", id: string): void {
  clearDirty(kind, id);
  if (!ledger.deleted[kind].includes(id)) {
    ledger.deleted[kind].push(id);
    saveLedger();
  }
}

function removeTombstone(kind: "tasks" | "memories", id: string): void {
  const idx = ledger.deleted[kind].indexOf(id);
  if (idx >= 0) {
    ledger.deleted[kind].splice(idx, 1);
    saveLedger();
  }
}

// ---------------------------------------------------------------------------
// Push machinery: per-entity ordered chains, debounced patches.
// ---------------------------------------------------------------------------

let pushesEnabled = true;

const chains = new Map<string, Promise<void>>();
const pendingOps = new Map<string, number>();
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function bumpPending(key: string): void {
  pendingOps.set(key, (pendingOps.get(key) ?? 0) + 1);
}

function enqueue(kind: EntityKind, id: string, job: () => Promise<boolean>): Promise<void> {
  const key = `${kind}:${id}`;
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    let ok = false;
    try {
      ok = await job();
    } catch (err) {
      console.warn(`[sifty-sync] push failed for ${key}:`, err);
    }
    const remaining = (pendingOps.get(key) ?? 1) - 1;
    if (remaining <= 0) pendingOps.delete(key);
    else pendingOps.set(key, remaining);
    if (ok && remaining <= 0 && !patchTimers.has(key)) {
      clearDirty(kind, id);
    }
  });
  chains.set(key, next);
  return next;
}

function schedulePatch(kind: EntityKind, id: string, job: () => Promise<boolean>): void {
  const key = `${kind}:${id}`;
  markDirty(kind, id);
  const existing = patchTimers.get(key);
  if (existing) clearTimeout(existing);
  patchTimers.set(
    key,
    setTimeout(() => {
      patchTimers.delete(key);
      bumpPending(key);
      void enqueue(kind, id, job);
    }, PATCH_DEBOUNCE_MS),
  );
}

function pushNow(kind: EntityKind, id: string, job: () => Promise<boolean>): Promise<void> {
  const key = `${kind}:${id}`;
  markDirty(kind, id);
  bumpPending(key);
  return enqueue(kind, id, job);
}

async function request(path: string, init?: RequestInit): Promise<Response | null> {
  if (!pushesEnabled) return null;
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 401) {
    pushesEnabled = false;
    return null;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Wire shapes.
// ---------------------------------------------------------------------------

function taskPatchBody(task: Task): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description,
    nextAction: task.nextAction,
    sourceContext: task.sourceContext,
    lifecycle: task.lifecycle,
    aiStatus: task.aiStatus,
    aiError: task.aiError,
    aiAttempts: task.aiAttempts,
    urgency: task.urgency,
    importance: task.importance,
    priorityBucket: task.priorityBucket,
    effort: task.effort,
    due: task.due,
    delegationCandidate: task.delegationCandidate,
    confidence: task.confidence,
    clarifyingQuestion: task.clarifyingQuestion,
    rationale: task.rationale,
    agentBrief: task.agentBrief,
    labelIds: task.labelIds,
    subtasks: task.subtasks,
    editedFields: task.editedFields,
  };
}

function taskCreateBody(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    sourceText: task.sourceText,
    sourceContext: task.sourceContext,
    createdAt: task.createdAt,
    ...taskPatchBody(task),
  };
}

/** Reads the entity at push time so a debounced job sends the latest state. */
function currentTask(id: string): Task | null {
  return useStore.getState().tasks.find((t) => t.id === id) ?? null;
}

function currentMemory(id: string): Memory | null {
  return useStore.getState().memories.find((m) => m.id === id) ?? null;
}

async function pushTaskCreateJob(id: string): Promise<boolean> {
  const task = currentTask(id);
  if (!task) return true; // deleted meanwhile; the delete job handles it
  const res = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify(taskCreateBody(task)),
  });
  if (!res) return false;
  if (res.status === 409) {
    console.warn(`[sifty-sync] task id conflict for ${id}; task stays local-only`);
    return true; // clearing dirty: retrying can never succeed
  }
  return res.ok;
}

async function pushTaskPatchJob(id: string): Promise<boolean> {
  const task = currentTask(id);
  if (!task) return true;
  const res = await request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(taskPatchBody(task)),
  });
  if (!res) return false;
  if (res.status === 404) return pushTaskCreateJob(id);
  return res.ok;
}

async function pushTaskDeleteJob(id: string): Promise<boolean> {
  const res = await request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res) return false;
  if (res.ok || res.status === 404) {
    removeTombstone("tasks", id);
    return true;
  }
  return false;
}

async function pushLabelJob(id: string): Promise<boolean> {
  const label = useStore.getState().labels.find((l) => l.id === id);
  if (!label) return true;
  const res = await request("/api/labels", { method: "PUT", body: JSON.stringify(label) });
  if (!res) return false;
  if (!res.ok) return false;
  const data = (await res.json()) as { label: Label };
  if (data.label.id !== label.id) {
    // Name collision: adopt the canonical server label and re-push any
    // tasks that referenced the local id.
    const affected = useStore.getState().remapLabel(label.id, data.label);
    clearDirty("labels", label.id);
    for (const taskId of affected) {
      schedulePatch("tasks", taskId, () => pushTaskPatchJob(taskId));
    }
  }
  return true;
}

async function pushMemoryCreateJob(id: string): Promise<boolean> {
  const memory = currentMemory(id);
  if (!memory) return true;
  const res = await request("/api/memories", { method: "POST", body: JSON.stringify(memory) });
  if (!res) return false;
  return res.ok;
}

async function pushMemoryPatchJob(id: string): Promise<boolean> {
  const memory = currentMemory(id);
  if (!memory) return true;
  const res = await request(`/api/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ text: memory.text, kind: memory.kind, pinned: memory.pinned }),
  });
  if (!res) return false;
  if (res.status === 404) return pushMemoryCreateJob(id);
  return res.ok;
}

async function pushMemoryDeleteJob(id: string): Promise<boolean> {
  const res = await request(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res) return false;
  if (res.ok || res.status === 404) {
    removeTombstone("memories", id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Store hooks: every user-originated mutation lands here.
// ---------------------------------------------------------------------------

const hooks: SyncHooks = {
  taskUpserted(task, opts) {
    if (opts.created) void pushNow("tasks", task.id, () => pushTaskCreateJob(task.id));
    else schedulePatch("tasks", task.id, () => pushTaskPatchJob(task.id));
  },
  taskDeleted(taskId) {
    addTombstone("tasks", taskId);
    void pushNow("tasks", taskId, () => pushTaskDeleteJob(taskId));
  },
  labelEnsured(label) {
    void pushNow("labels", label.id, () => pushLabelJob(label.id));
  },
  memoryUpserted(memory, opts) {
    if (opts.created) void pushNow("memories", memory.id, () => pushMemoryCreateJob(memory.id));
    else schedulePatch("memories", memory.id, () => pushMemoryPatchJob(memory.id));
  },
  memoryDeleted(memoryId) {
    addTombstone("memories", memoryId);
    void pushNow("memories", memoryId, () => pushMemoryDeleteJob(memoryId));
  },
  waitForTask(taskId) {
    return chains.get(`tasks:${taskId}`) ?? Promise.resolve();
  },
  isTaskDirty(taskId) {
    return isDirty("tasks", taskId) || patchTimers.has(`tasks:${taskId}`);
  },
};

registerSyncHooks(hooks);

/** Sign-out / account-switch: drop the local cache and the sync ledger. */
export function resetLocalWorkspace(): void {
  useStore.setState({ tasks: [], labels: [], memories: [] });
  ledger = emptyLedger();
  saveLedger();
}

// ---------------------------------------------------------------------------
// Pull + reconcile.
// ---------------------------------------------------------------------------

export interface ServerSyncState {
  hydrated: boolean;
  authenticated: boolean;
  error: string | null;
}

export function useServerSync(): ServerSyncState {
  const [state, setState] = React.useState<ServerSyncState>({
    hydrated: false,
    authenticated: false,
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await pullAndReconcile();
        if (!cancelled) setState({ hydrated: true, ...result });
      } catch (err) {
        if (!cancelled) {
          setState({
            hydrated: true,
            authenticated: false,
            error: err instanceof Error ? err.message : "Network error",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

async function pullAndReconcile(): Promise<{ authenticated: boolean; error: string | null }> {
  const meRes = await fetch("/api/auth/me", { credentials: "include" });
  if (meRes.status === 401) {
    pushesEnabled = false;
    return { authenticated: false, error: null };
  }
  if (!meRes.ok) return { authenticated: false, error: "Failed to load session" };
  const me = (await meRes.json()) as { user: { id: string } };

  if (!ledgerExistedAtBoot && !ledger.lastUserId) {
    // First run of the sync-aware build in this browser. Anything already
    // in localStorage predates per-user tracking — claim it for the
    // signed-in account so no local data is silently lost.
    const store = useStore.getState();
    for (const t of store.tasks) markDirty("tasks", t.id);
    for (const m of store.memories) markDirty("memories", m.id);
    for (const l of store.labels) markDirty("labels", l.id);
  } else if (ledger.lastUserId && ledger.lastUserId !== me.user.id) {
    // Different account on a shared browser: never replay the previous
    // user's workspace into this one.
    resetLocalWorkspace();
  }
  ledger.lastUserId = me.user.id;
  saveLedger();
  pushesEnabled = true;

  const [tasksRes, labelsRes, memsRes] = await Promise.all([
    fetch("/api/tasks", { credentials: "include" }),
    fetch("/api/labels", { credentials: "include" }),
    fetch("/api/memories", { credentials: "include" }),
  ]);
  if (!tasksRes.ok || !labelsRes.ok || !memsRes.ok) {
    return { authenticated: true, error: "Failed to load workspace" };
  }
  const serverTasks = ((await tasksRes.json()) as { tasks: Task[] }).tasks;
  const serverLabels = ((await labelsRes.json()) as { labels: Label[] }).labels;
  const serverMemories = ((await memsRes.json()) as { memories: Memory[] }).memories;

  reconcile(serverTasks, serverLabels, serverMemories);
  flushPending();
  resumeInterruptedTriage();

  return { authenticated: true, error: null };
}

function reconcile(serverTasks: Task[], serverLabels: Label[], serverMemories: Memory[]): void {
  const local = useStore.getState();

  // Tasks: dirty-local wins, clean rows follow the server, tombstones and
  // remote deletions are honored.
  const serverTaskIds = new Set(serverTasks.map((t) => t.id));
  const localTaskById = new Map(local.tasks.map((t) => [t.id, t]));
  const mergedTasks: Task[] = serverTasks
    .filter((t) => !ledger.deleted.tasks.includes(t.id))
    .map((serverTask) => {
      const localTask = localTaskById.get(serverTask.id);
      return localTask && isDirty("tasks", serverTask.id) ? localTask : serverTask;
    });
  for (const localTask of local.tasks) {
    if (serverTaskIds.has(localTask.id)) continue;
    if (isDirty("tasks", localTask.id)) mergedTasks.push(localTask);
    // else: deleted on another device — drop it here too.
  }

  // Memories: same contract as tasks.
  const serverMemoryIds = new Set(serverMemories.map((m) => m.id));
  const localMemoryById = new Map(local.memories.map((m) => [m.id, m]));
  const mergedMemories: Memory[] = serverMemories
    .filter((m) => !ledger.deleted.memories.includes(m.id))
    .map((serverMemory) => {
      const localMemory = localMemoryById.get(serverMemory.id);
      return localMemory && isDirty("memories", serverMemory.id) ? localMemory : serverMemory;
    });
  for (const localMemory of local.memories) {
    if (serverMemoryIds.has(localMemory.id)) continue;
    if (isDirty("memories", localMemory.id)) mergedMemories.push(localMemory);
  }

  // Labels have no deletion; the merged set is the union. Local-only labels
  // whose name collides with a server label are remapped after the state
  // update (below) so task references stay valid.
  const serverLabelIds = new Set(serverLabels.map((l) => l.id));
  const serverLabelsByName = new Map(serverLabels.map((l) => [l.name.toLowerCase(), l]));
  const collisions: Array<{ localId: string; canonical: Label }> = [];
  const keptLocalLabels: Label[] = [];
  for (const localLabel of local.labels) {
    if (serverLabelIds.has(localLabel.id)) continue;
    const collision = serverLabelsByName.get(localLabel.name.toLowerCase());
    if (collision) collisions.push({ localId: localLabel.id, canonical: collision });
    else keptLocalLabels.push(localLabel);
  }

  useStore.setState({
    tasks: mergedTasks,
    labels: [...serverLabels, ...keptLocalLabels],
    memories: mergedMemories,
  });

  for (const { localId, canonical } of collisions) {
    const affected = useStore.getState().remapLabel(localId, canonical);
    clearDirty("labels", localId);
    for (const taskId of affected) {
      if (serverTaskIds.has(taskId)) markDirty("tasks", taskId);
    }
  }
}

/** Replay everything the ledger says never reached the server. */
function flushPending(): void {
  const state = useStore.getState();

  for (const id of [...ledger.deleted.tasks]) {
    void pushNow("tasks", id, () => pushTaskDeleteJob(id));
  }
  for (const id of [...ledger.deleted.memories]) {
    void pushNow("memories", id, () => pushMemoryDeleteJob(id));
  }
  for (const id of [...ledger.dirty.labels]) {
    void pushNow("labels", id, () => pushLabelJob(id));
  }
  for (const id of [...ledger.dirty.tasks]) {
    if (!state.tasks.some((t) => t.id === id)) {
      clearDirty("tasks", id);
      continue;
    }
    void pushNow("tasks", id, () => pushTaskPatchJob(id));
  }
  for (const id of [...ledger.dirty.memories]) {
    if (!state.memories.some((m) => m.id === id)) {
      clearDirty("memories", id);
      continue;
    }
    void pushNow("memories", id, () => pushMemoryPatchJob(id));
  }
}

/**
 * Tasks left `pending`/`running` by an interrupted session would otherwise
 * show "AI organizing" forever. Resume a bounded number; mark the rest
 * failed so the retry affordance appears.
 */
function resumeInterruptedTriage(): void {
  const stale = useStore
    .getState()
    .tasks.filter(
      (t) => (t.aiStatus === "pending" || t.aiStatus === "running") && !isTriageInFlight(t.id),
    );
  for (const t of stale.slice(0, AUTO_RESUME_LIMIT)) {
    void runTriage(t.id);
  }
  for (const t of stale.slice(AUTO_RESUME_LIMIT)) {
    useStore.getState().setAiStatus(t.id, "failed", "Interrupted — run triage again.");
  }
}
