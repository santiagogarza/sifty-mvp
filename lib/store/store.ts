"use client";

import {
  DEFAULT_MODEL_PREFERENCE,
  type ModelPreference,
  normalizeModelPreference,
} from "@/lib/ai/models";
import { normalizeAssigneeName } from "@/lib/domain/assignee";
import { TASK_LIMITS } from "@/lib/domain/limits";
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

/**
 * Which top-level fields a mutation touched. The sync layer pushes exactly
 * these keys, so two devices editing different fields never clobber each
 * other and a server-side write (triage, agent brief) survives a pending
 * local edit. Undefined means "unknown — push the whole entity".
 */
export type ChangedKeys<T> = ReadonlyArray<keyof T & string>;

export interface SyncHooks {
  taskUpserted(task: Task, opts: { created: boolean; changedKeys?: ChangedKeys<Task> }): void;
  taskDeleted(taskId: string): void;
  labelEnsured(label: Label): void;
  memoryUpserted(
    memory: Memory,
    opts: { created: boolean; changedKeys?: ChangedKeys<Memory> },
  ): void;
  memoryDeleted(memoryId: string): void;
  /** Resolves when the task's create push has settled (ok or not). */
  waitForTask(taskId: string): Promise<void>;
  isTaskDirty(taskId: string): boolean;
}

/** How task pages render: linear list, or the kanban board. */
export type TaskViewMode = "list" | "board";

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
  /** Settings → AI model. A preference id from `MODEL_PREFERENCES`, never a raw model id. */
  modelPreference: ModelPreference;
  viewMode: TaskViewMode;
  /** First-run welcome card closed on this device. */
  welcomeDismissed: boolean;

  setHydrated: (v: boolean) => void;
  setModelPreference: (preference: ModelPreference) => void;
  setViewMode: (mode: TaskViewMode) => void;
  dismissWelcome: () => void;

  createTask: (input: {
    sourceText: string;
    sourceContext?: string | null;
    /**
     * A due date the user confirmed at capture (natural-language chip). It
     * is recorded as a user edit so the sift never overwrites it.
     */
    due?: string | null;
    /** Provisional title when it should differ from the raw text (date phrase removed). */
    title?: string | null;
  }) => Task;
  updateTask: (
    id: string,
    patch: Partial<Task>,
    opts?: { editedFields?: TaskEditableField[] },
  ) => void;
  deleteTask: (id: string) => void;
  /**
   * Copy a task's content into a new task (same create path as `createTask`
   * so sync picks it up). Subtasks reset to not done with fresh ids; due,
   * completion, AI history, and the agent brief are not copied. Returns
   * the copy, or null when the source is gone.
   */
  duplicateTask: (id: string) => Task | null;
  /** Patch several tasks' status in one go, each through `updateTask`. */
  moveTasksToLifecycle: (ids: readonly string[], lifecycle: Lifecycle) => void;
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
  /**
   * Adopt server-owned fields (sift progress, AI status) without marking
   * the task dirty: nothing here is pushed back.
   */
  patchTaskFromServer: (taskId: string, patch: Partial<Task>) => void;
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

const VERSION = 4;

/** Bookkeeping fields the server derives itself; never worth a push. */
const UNSYNCED_KEYS = new Set(["id", "createdAt", "updatedAt", "completedAt"]);

/**
 * Shallow key diff. Mutations build new arrays/objects only for the fields
 * they touch, so reference inequality is an exact change signal.
 */
function changedKeys<T extends object>(prev: T | undefined, next: T): ChangedKeys<T> | undefined {
  if (!prev) return undefined;
  return (Object.keys(next) as Array<keyof T & string>).filter(
    (key) => !UNSYNCED_KEYS.has(key) && prev[key] !== next[key],
  );
}

export const useStore = create<SiftyState>()(
  persist(
    (set, get) => {
      const findTask = (taskId: string) => get().tasks.find((t) => t.id === taskId);
      /** Call after `set` with the row captured before it. */
      const notifyTask = (taskId: string, prev: Task | undefined) => {
        const task = findTask(taskId);
        if (task) {
          syncHooks?.taskUpserted(task, { created: false, changedKeys: changedKeys(prev, task) });
        }
      };

      return {
        hydrated: false,
        tasks: [],
        labels: [],
        memories: [],
        modelPreference: DEFAULT_MODEL_PREFERENCE,
        viewMode: "list",
        welcomeDismissed: false,

        setHydrated: (v) => set({ hydrated: v }),
        setModelPreference: (preference) => set({ modelPreference: preference }),
        setViewMode: (mode) => set({ viewMode: mode }),
        dismissWelcome: () => set({ welcomeDismissed: true }),

        createTask: ({ sourceText, sourceContext, due, title }) => {
          const now = new Date().toISOString();
          const text = sourceText.trim();
          const titleSource = title?.trim() || text;
          const provisionalTitle =
            titleSource.length > 80
              ? `${titleSource.slice(0, 78)}…`
              : titleSource || "Untitled task";

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
            due: due ?? null,
            delegationCandidate: "unsure",
            assigneeName: null,
            confidence: 0,
            clarifyingQuestion: null,
            rationale: null,
            agentBrief: null,
            siftId: null,
            siftStage: null,
            plan: null,
            labelIds: [],
            subtasks: [],
            editedFields: due ? ["due"] : [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };
          set((s) => ({ tasks: [task, ...s.tasks] }));
          syncHooks?.taskUpserted(task, { created: true });
          return task;
        },

        updateTask: (id, patch, opts) => {
          const prev = findTask(id);
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
          notifyTask(id, prev);
        },

        deleteTask: (id) => {
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
          syncHooks?.taskDeleted(id);
        },

        duplicateTask: (sourceId) => {
          const source = findTask(sourceId);
          if (!source) return null;
          const now = new Date().toISOString();
          const suffix = " (copy)";
          const title = `${source.title.slice(0, TASK_LIMITS.title - suffix.length)}${suffix}`;
          // A finished or dropped original is new work again: it lands in
          // the Inbox so the filing strip offers where it goes next.
          const lifecycle: Lifecycle =
            source.lifecycle === "done" || source.lifecycle === "dropped"
              ? "inbox"
              : source.lifecycle;
          const copy: Task = {
            id: id("task"),
            sourceText: source.sourceText,
            sourceContext: source.sourceContext,
            title,
            description: source.description,
            nextAction: source.nextAction,
            lifecycle,
            // Content is already organized; nothing to resume. Idle keeps the
            // copy out of the stale-triage recovery sweep.
            aiStatus: source.aiStatus === "ready" ? "ready" : "idle",
            aiError: null,
            aiAttempts: 0,
            urgency: source.urgency,
            importance: source.importance,
            priorityBucket: source.priorityBucket,
            effort: source.effort,
            due: null,
            delegationCandidate: source.delegationCandidate,
            assigneeName: source.assigneeName,
            confidence: 0,
            clarifyingQuestion: null,
            rationale: null,
            agentBrief: null,
            siftId: null,
            siftStage: null,
            plan: null,
            labelIds: [...source.labelIds],
            subtasks: source.subtasks.map((st) => ({
              id: id("st"),
              title: st.title,
              done: false,
              order: st.order,
            })),
            // `due` is deliberately empty on the copy, so it must not stay
            // protected: a later re-sift should be free to propose a date.
            editedFields: source.editedFields.filter((f) => f !== "due"),
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };
          set((s) => ({ tasks: [copy, ...s.tasks] }));
          syncHooks?.taskUpserted(copy, { created: true });
          return copy;
        },

        moveTasksToLifecycle: (ids, lifecycle) => {
          const { updateTask } = get();
          for (const taskId of ids) {
            if (findTask(taskId)) updateTask(taskId, { lifecycle });
          }
        },

        toggleSubtask: (taskId, subtaskId) => {
          const prev = findTask(taskId);
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
          notifyTask(taskId, prev);
        },

        addSubtask: (taskId, title) => {
          const cleaned = title.trim();
          if (!cleaned) return;
          const prev = findTask(taskId);
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
          notifyTask(taskId, prev);
        },

        removeSubtask: (taskId, subtaskId) => {
          const prev = findTask(taskId);
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
          notifyTask(taskId, prev);
        },

        setLifecycle: (taskId, lifecycle) => {
          get().updateTask(taskId, { lifecycle });
        },

        setAiStatus: (taskId, status, error) => {
          const prev = findTask(taskId);
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id !== taskId ? t : { ...t, aiStatus: status, aiError: error ?? null },
            ),
          }));
          notifyTask(taskId, prev);
        },

        applyTriage: (taskId, triage) => {
          const prev = findTask(taskId);
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id !== taskId ? t : mergeTriageIntoTask(t, triage))),
          }));
          notifyTask(taskId, prev);
        },

        replaceTaskFromServer: (task) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
          }));
        },

        patchTaskFromServer: (taskId, patch) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
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
          const prev = get().memories.find((m) => m.id === id);
          set((s) => ({
            memories: s.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          }));
          const memory = get().memories.find((m) => m.id === id);
          if (memory) {
            syncHooks?.memoryUpserted(memory, {
              created: false,
              changedKeys: changedKeys(prev, memory),
            });
          }
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
        modelPreference: s.modelPreference,
        viewMode: s.viewMode,
        welcomeDismissed: s.welcomeDismissed,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Partial<SiftyState>;
        if (version < 2 && state.tasks) {
          state.tasks = state.tasks.map((t) => ({ ...t, agentBrief: t.agentBrief ?? null }));
        }
        if (version < 3 && state.tasks) {
          state.tasks = state.tasks.map((t) => ({ ...t, assigneeName: t.assigneeName ?? null }));
        }
        if (version < 4) {
          // v3 persisted a raw model id (`preferredModelId`); map it onto the registry preference.
          const legacy = (persisted as { preferredModelId?: string }).preferredModelId;
          state.modelPreference = normalizeModelPreference(legacy);
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
