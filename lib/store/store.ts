"use client";

import { DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { normalizeAssigneeName } from "@/lib/domain/assignee";
import { bucketFromScalars } from "@/lib/domain/priority";
import { mergeTriageIntoTask } from "@/lib/domain/triage-merge";
import {
  type AiStatus,
  type Label,
  type Lifecycle,
  type Memory,
  type Subtask,
  type Task,
  type TaskEditableField,
} from "@/lib/domain/types";
import { id } from "@/lib/utils/ids";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Client store: optimistic source of truth for the UI, persisted to
 * localStorage, synchronized to the server.
 *
 * Sync design:
 *
 * - Every user-originated mutation notifies the registered `SyncHooks`
 *   (see `lib/store/sync.ts`), which pushes it to the API in the
 *   background. The UI never waits on the network.
 * - Server-originated updates (`replaceTaskFromServer`, `upsertLabels`)
 *   deliberately do NOT notify hooks — pushing them back would echo.
 * - The store starts empty. Workspace content (default labels, optional
 *   demo data) is seeded server-side so it is durable and identical on
 *   every device.
 * - `editedFields` is set on every direct user edit; re-triage respects it
 *   via the shared `mergeTriageIntoTask` helper.
 */

export interface SyncHooks {
  taskUpserted(task: Task, opts: { created: boolean }): void;
  taskDeleted(taskId: string): void;
  labelEnsured(label: Label): void;
  memoryUpserted(memory: Memory, opts: { created: boolean }): void;
  memoryDeleted(memoryId: string): void;
  /** Resolves when the task's create push has settled (ok or not). */
  waitForTask(taskId: string): Promise<void>;
  isTaskDirty(taskId: string): boolean;
}

let syncHooks: SyncHooks | null = null;

export function registerSyncHooks(hooks: SyncHooks | null): void {
  syncHooks = hooks;
}

export function getSyncHooks(): SyncHooks | null {
  return syncHooks;
}

interface SiftyState {
  hydrated: boolean;
  tasks: Task[];
  labels: Label[];
  memories: Memory[];
  preferredModelId: string;
  viewMode: ViewMode;

  setHydrated: (v: boolean) => void;
  setPreferredModelId: (modelId: string) => void;
  setViewMode: (mode: ViewMode) => void;

  createTask: (input: { sourceText: string; sourceContext?: string | null }) => Task;
  updateTask: (
    id: string,
    patch: Partial<Task>,
    opts?: { editedFields?: TaskEditableField[] },
  ) => void;
  deleteTask: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  removeSubtask: (taskId: string, subtaskId: string) => void;
  setLifecycle: (taskId: string, lifecycle: Lifecycle) => void;
  setAiStatus: (taskId: string, status: AiStatus, error?: string | null) => void;
  applyTriage: (
    taskId: string,
    triage: {
      title: string;
      description: string | null;
      nextAction: string | null;
      urgency: number;
      importance: number;
      effort: Task["effort"];
      due: string | null;
      delegationCandidate: Task["delegationCandidate"];
      labelIds: string[];
      subtasks: Subtask[];
      rationale: string | null;
      confidence: number;
      clarifyingQuestion: string | null;
    },
  ) => void;

  /**
   * Server-origin: replace a task with its canonical server state. No
   * push. Update-only — if the task was deleted while the server call ran,
   * adopting the response would resurrect it as a ghost.
   */
  replaceTaskFromServer: (task: Task) => void;
  /** Server-origin: merge labels into the local set. No push. */
  upsertLabels: (labels: Label[]) => void;
  /**
   * The sync layer hit an id conflict (409): give the entity a fresh id so
   * its create push can succeed. Returns the new id, or null if the entity
   * is gone. No push — the caller re-pushes under the new id.
   */
  adoptFreshTaskId: (oldId: string) => string | null;
  adoptFreshMemoryId: (oldId: string) => string | null;
  /**
   * Adopt the server's canonical id for a label that collided by name.
   * Returns the ids of tasks whose labelIds were rewritten (they need a
   * re-push, which the sync layer handles).
   */
  remapLabel: (localId: string, canonical: Label) => string[];

  addMemory: (input: { text: string; kind?: Memory["kind"]; pinned?: boolean }) => Memory;
  updateMemory: (id: string, patch: Partial<Memory>) => void;
  removeMemory: (id: string) => void;

  ensureLabel: (name: string) => Label;
}

export type ViewMode = "list" | "board";

const VERSION = 3;

export const useStore = create<SiftyState>()(
  persist(
    (set, get) => {
      const notifyTask = (taskId: string, opts: { created: boolean }) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (task) syncHooks?.taskUpserted(task, opts);
      };

      return {
        hydrated: false,
        tasks: [],
        labels: [],
        memories: [],
        preferredModelId: DEFAULT_MODEL_ID,
        viewMode: "list",

        setHydrated: (v) => set({ hydrated: v }),
        setPreferredModelId: (modelId) => set({ preferredModelId: modelId }),
        setViewMode: (mode) => set({ viewMode: mode }),

        createTask: ({ sourceText, sourceContext }) => {
          const now = new Date().toISOString();
          const text = sourceText.trim();
          const provisionalTitle =
            text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task";

          const task: Task = {
            id: id("task"),
            sourceText: text,
            sourceContext: sourceContext?.trim() || null,
            title: provisionalTitle,
            description: sourceContext?.trim() || null,
            nextAction: null,
            lifecycle: "inbox",
            aiStatus: "pending",
            aiError: null,
            aiAttempts: 0,
            urgency: 0.4,
            importance: 0.4,
            priorityBucket: "unset",
            effort: "small",
            due: null,
            delegationCandidate: "unsure",
            assigneeName: null,
            confidence: 0,
            clarifyingQuestion: null,
            rationale: null,
            agentBrief: null,
            labelIds: [],
            subtasks: [],
            editedFields: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };
          set((s) => ({ tasks: [task, ...s.tasks] }));
          syncHooks?.taskUpserted(task, { created: true });
          return task;
        },

        updateTask: (id, patch, opts) => {
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (t.id !== id) return t;
              const editedFields = opts?.editedFields
                ? Array.from(new Set([...t.editedFields, ...opts.editedFields]))
                : t.editedFields;
              const scopedPatch = { ...patch };
              if ("assigneeName" in patch) {
                scopedPatch.assigneeName = normalizeAssigneeName(patch.assigneeName);
              }
              const next: Task = {
                ...t,
                ...scopedPatch,
                editedFields,
                updatedAt: new Date().toISOString(),
              };
              if (
                ("urgency" in patch || "importance" in patch) &&
                !("priorityBucket" in patch) &&
                !editedFields.includes("priorityBucket")
              ) {
                next.priorityBucket = bucketFromScalars(next.urgency, next.importance);
              }
              if (patch.lifecycle === "done" && !t.completedAt) {
                next.completedAt = next.updatedAt;
              }
              if (patch.lifecycle && patch.lifecycle !== "done") {
                next.completedAt = null;
              }
              return next;
            }),
          }));
          notifyTask(id, { created: false });
        },

        deleteTask: (id) => {
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
          syncHooks?.taskDeleted(id);
        },

        toggleSubtask: (taskId, subtaskId) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    subtasks: t.subtasks.map((st) =>
                      st.id === subtaskId ? { ...st, done: !st.done } : st,
                    ),
                    updatedAt: new Date().toISOString(),
                    editedFields: Array.from(new Set([...t.editedFields, "subtasks"])),
                  },
            ),
          }));
          notifyTask(taskId, { created: false });
        },

        addSubtask: (taskId, title) => {
          const cleaned = title.trim();
          if (!cleaned) return;
          set((s) => ({
            tasks: s.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const order = t.subtasks.length;
              return {
                ...t,
                subtasks: [...t.subtasks, { id: id("st"), title: cleaned, done: false, order }],
                updatedAt: new Date().toISOString(),
                editedFields: Array.from(new Set([...t.editedFields, "subtasks"])),
              };
            }),
          }));
          notifyTask(taskId, { created: false });
        },

        removeSubtask: (taskId, subtaskId) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id !== taskId
                ? t
                : {
                    ...t,
                    subtasks: t.subtasks.filter((st) => st.id !== subtaskId),
                    updatedAt: new Date().toISOString(),
                    editedFields: Array.from(new Set([...t.editedFields, "subtasks"])),
                  },
            ),
          }));
          notifyTask(taskId, { created: false });
        },

        setLifecycle: (taskId, lifecycle) => {
          get().updateTask(taskId, { lifecycle });
        },

        setAiStatus: (taskId, status, error) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id !== taskId ? t : { ...t, aiStatus: status, aiError: error ?? null },
            ),
          }));
          notifyTask(taskId, { created: false });
        },

        applyTriage: (taskId, triage) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id !== taskId ? t : mergeTriageIntoTask(t, triage))),
          }));
          notifyTask(taskId, { created: false });
        },

        replaceTaskFromServer: (task) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
          }));
        },

        upsertLabels: (labels) => {
          if (!labels.length) return;
          set((s) => {
            const byId = new Map(s.labels.map((l) => [l.id, l]));
            for (const label of labels) byId.set(label.id, label);
            return { labels: Array.from(byId.values()) };
          });
        },

        adoptFreshTaskId: (oldId) => {
          if (!get().tasks.some((t) => t.id === oldId)) return null;
          const newId = id("task");
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === oldId ? { ...t, id: newId } : t)),
          }));
          return newId;
        },

        adoptFreshMemoryId: (oldId) => {
          if (!get().memories.some((m) => m.id === oldId)) return null;
          const newId = id("mem");
          set((s) => ({
            memories: s.memories.map((m) => (m.id === oldId ? { ...m, id: newId } : m)),
          }));
          return newId;
        },

        remapLabel: (localId, canonical) => {
          const affected: string[] = [];
          set((s) => ({
            labels: [
              ...s.labels.filter((l) => l.id !== localId && l.id !== canonical.id),
              canonical,
            ],
            tasks: s.tasks.map((t) => {
              if (!t.labelIds.includes(localId)) return t;
              affected.push(t.id);
              return {
                ...t,
                labelIds: Array.from(
                  new Set(t.labelIds.map((id) => (id === localId ? canonical.id : id))),
                ),
              };
            }),
          }));
          return affected;
        },

        addMemory: ({ text, kind, pinned }) => {
          const memory: Memory = {
            id: id("mem"),
            text,
            kind: kind ?? "preference",
            pinned: pinned ?? false,
            createdAt: new Date().toISOString(),
          };
          set((s) => ({ memories: [memory, ...s.memories] }));
          syncHooks?.memoryUpserted(memory, { created: true });
          return memory;
        },

        updateMemory: (id, patch) => {
          set((s) => ({
            memories: s.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          }));
          const memory = get().memories.find((m) => m.id === id);
          if (memory) syncHooks?.memoryUpserted(memory, { created: false });
        },

        removeMemory: (id) => {
          set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
          syncHooks?.memoryDeleted(id);
        },

        ensureLabel: (name) => {
          const trimmed = name.trim();
          const existing = get().labels.find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
          if (existing) return existing;
          const palette: Label["tone"][] = ["neutral", "mist", "sand", "sage", "ember"];
          const tone = palette[get().labels.length % palette.length] ?? "neutral";
          const label: Label = { id: id("label"), name: trimmed, tone };
          set((s) => ({ labels: [...s.labels, label] }));
          syncHooks?.labelEnsured(label);
          return label;
        },
      };
    },
    {
      name: "sifty-store-v1",
      version: VERSION,
      partialize: (s) => ({
        tasks: s.tasks,
        labels: s.labels,
        memories: s.memories,
        preferredModelId: s.preferredModelId,
        viewMode: s.viewMode,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<SiftyState>;
        if (version < 2 && state.tasks) {
          state.tasks = state.tasks.map((t) => ({ ...t, agentBrief: t.agentBrief ?? null }));
        }
        if (version < 3 && state.tasks) {
          state.tasks = state.tasks.map((t) => ({ ...t, assigneeName: t.assigneeName ?? null }));
        }
        return state as SiftyState;
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export type { SiftyState };
