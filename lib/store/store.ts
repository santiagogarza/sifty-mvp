"use client";

import { bucketFromScalars } from "@/lib/domain/priority";
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
import { seedLabels, seedMemories, seedTasks } from "./seed";

/**
 * Client-authoritative store with optimistic CRUD and localStorage persistence.
 *
 * MVP design notes:
 *
 * - The store is the source of truth for the UI. AI triage runs against an
 *   API route and mutates the store with the result; the network call is
 *   non-blocking, so capture stays instant.
 *
 * - We keep the persistence boundary small — only the data fields, never
 *   ephemeral UI state. That makes the swap to a real backend trivial.
 *
 * - `editedFields` is set on every direct user edit. Re-triage respects it.
 */

interface SiftyState {
  hydrated: boolean;
  tasks: Task[];
  labels: Label[];
  memories: Memory[];

  setHydrated: (v: boolean) => void;

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

  ensureLabel: (name: string) => Label;
}

const VERSION = 1;

export const useStore = create<SiftyState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      tasks: seedTasks(),
      labels: seedLabels(),
      memories: seedMemories(),

      setHydrated: (v) => set({ hydrated: v }),

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
          confidence: 0,
          clarifyingQuestion: null,
          rationale: null,
          labelIds: [],
          subtasks: [],
          editedFields: [],
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return task;
      },

      updateTask: (id, patch, opts) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const editedFields = opts?.editedFields
              ? Array.from(new Set([...t.editedFields, ...opts.editedFields]))
              : t.editedFields;
            const next: Task = {
              ...t,
              ...patch,
              editedFields,
              updatedAt: new Date().toISOString(),
            };
            if (
              ("urgency" in patch ||
                "importance" in patch ||
                opts?.editedFields?.includes("urgency") ||
                opts?.editedFields?.includes("importance")) &&
              !opts?.editedFields?.includes("priorityBucket")
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
      },

      deleteTask: (id) => {
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
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
      },

      applyTriage: (taskId, triage) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const protect = (field: TaskEditableField) => t.editedFields.includes(field);
            const next: Task = { ...t };

            if (!protect("title")) next.title = triage.title;
            if (!protect("description")) next.description = triage.description ?? t.description;
            if (!protect("nextAction")) next.nextAction = triage.nextAction;
            if (!protect("urgency")) next.urgency = triage.urgency;
            if (!protect("importance")) next.importance = triage.importance;
            if (!protect("effort")) next.effort = triage.effort;
            if (!protect("due")) next.due = triage.due;
            if (!protect("delegationCandidate")) {
              next.delegationCandidate = triage.delegationCandidate;
            }
            if (!protect("labelIds") && triage.labelIds.length) {
              next.labelIds = triage.labelIds;
            }
            if (!protect("subtasks") && triage.subtasks.length) next.subtasks = triage.subtasks;

            if (!protect("priorityBucket")) {
              next.priorityBucket = bucketFromScalars(next.urgency, next.importance);
            }

            next.rationale = triage.rationale;
            next.confidence = triage.confidence;
            next.clarifyingQuestion = triage.clarifyingQuestion;
            next.aiStatus = "ready";
            next.aiError = null;
            next.aiAttempts = t.aiAttempts + 1;
            next.updatedAt = new Date().toISOString();
            return next;
          }),
        }));
      },

      ensureLabel: (name) => {
        const trimmed = name.trim();
        const existing = get().labels.find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing;
        const palette: Label["tone"][] = ["neutral", "mist", "sand", "sage", "ember"];
        const tone = palette[get().labels.length % palette.length] ?? "neutral";
        const label: Label = { id: id("label"), name: trimmed, tone };
        set((s) => ({ labels: [...s.labels, label] }));
        return label;
      },
    }),
    {
      name: "sifty-store-v1",
      version: VERSION,
      partialize: (s) => ({ tasks: s.tasks, labels: s.labels, memories: s.memories }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export type { SiftyState };
