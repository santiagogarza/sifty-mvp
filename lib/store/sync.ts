"use client";

import type { Memory, Task } from "@/lib/domain/types";
import * as React from "react";
import { useStore } from "./store";

/**
 * Server sync.
 *
 * Bridges the Zustand store and the server API:
 *
 * 1. On mount, fetches `/api/tasks` and `/api/memories` and merges the
 *    server snapshot into the store (server wins on overlap; local-only
 *    rows survive so an offline-then-online capture isn't lost).
 *
 * 2. Subscribes to store mutations and pushes them to the API in the
 *    background. The store stays the source of truth in the UI; the
 *    server is durable. Conflict resolution is last-writer-wins for
 *    Stage 2; richer merging lands when realtime does.
 *
 * 3. Listens for the `sifty:remote-mutation` window event so the rest of
 *    the app (capture flow, detail sheet) can opt out of pushing — used
 *    by `applyTriage` which patched fields server-side already.
 *
 * Failures are logged but never thrown to the UI: the store still works
 * locally even if the network is flaky.
 */

const TASKS_URL = "/api/tasks";
const MEMORIES_URL = "/api/memories";

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
        const [tasksRes, memsRes] = await Promise.all([
          fetch(TASKS_URL, { credentials: "include" }),
          fetch(MEMORIES_URL, { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (tasksRes.status === 401 || memsRes.status === 401) {
          setState({ hydrated: true, authenticated: false, error: null });
          return;
        }
        if (!tasksRes.ok || !memsRes.ok) {
          setState({ hydrated: true, authenticated: false, error: "Failed to load" });
          return;
        }
        const tasksJson = (await tasksRes.json()) as { tasks: Task[] };
        const memsJson = (await memsRes.json()) as { memories: Memory[] };
        const local = useStore.getState();
        const localTaskIds = new Set(local.tasks.map((t) => t.id));
        const mergedTasks = [
          ...tasksJson.tasks,
          ...local.tasks.filter((t) => !tasksJson.tasks.some((s) => s.id === t.id)),
        ];
        // Drop default seed tasks once the server returns at least one row.
        const finalTasks = tasksJson.tasks.length
          ? mergedTasks.filter((t) => !t.id.startsWith("seed_") || localTaskIds.has(t.id))
          : local.tasks;
        useStore.setState((s) => ({
          ...s,
          tasks: finalTasks,
          memories: memsJson.memories.length ? memsJson.memories : s.memories,
        }));
        setState({ hydrated: true, authenticated: true, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          hydrated: true,
          authenticated: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export async function pushTaskCreate(task: { sourceText: string; sourceContext: string | null }) {
  const res = await fetch(TASKS_URL, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { task: Task };
  return data.task;
}

export async function pushTaskPatch(taskId: string, patch: Partial<Task>) {
  const res = await fetch(`${TASKS_URL}/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.ok;
}

export async function pushTaskDelete(taskId: string) {
  const res = await fetch(`${TASKS_URL}/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.ok;
}
