import { bucketFromScalars } from "@/lib/domain/priority";
import type { Memory, Subtask, Task, TaskEditableField, UserProfile } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";
import { nanoid } from "nanoid";
import type {
  AiRunRepo,
  AiRunWriteInput,
  EntitlementRepo,
  EntitlementSnapshot,
  MemoryRepo,
  Repos,
  SessionRepo,
  StripeEventRepo,
  TaskCreateInput,
  TaskRepo,
  UserCreateInput,
  UserRepo,
} from "./types";

/**
 * In-memory repos.
 *
 * Used by tests and by the local dev fallback when `DATABASE_URL` is not
 * set. Mirrors the same call surface and tenancy invariants as the
 * Postgres implementation: every method takes `userId` and won't return
 * other users' rows.
 */

interface State {
  users: Map<string, UserProfile & { passwordHash: string | null }>;
  emails: Map<string, string>; // lowercased email → user id
  entitlements: Map<string, EntitlementSnapshot>;
  tasks: Map<string, Task & { userId: string }>;
  memories: Map<string, Memory & { userId: string }>;
  aiRuns: Array<{
    id: string;
    userId: string;
    taskId: string | null;
    promptVersion: string;
    model: string;
    transport: string;
    status: "succeeded" | "failed";
    durationMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    costCents: number | null;
    offline: boolean;
    error: string | null;
    createdAt: string;
  }>;
  sessions: Map<string, { userId: string; expiresAt: string }>;
  stripeEvents: Set<string>;
}

function emptyState(): State {
  return {
    users: new Map(),
    emails: new Map(),
    entitlements: new Map(),
    tasks: new Map(),
    memories: new Map(),
    aiRuns: [],
    sessions: new Map(),
    stripeEvents: new Set(),
  };
}

export interface MemoryReposHandle extends Repos {
  __reset(): void;
  __state(): Readonly<State>;
}

export function createMemoryRepos(): MemoryReposHandle {
  let state = emptyState();

  const users: UserRepo = {
    async create(input: UserCreateInput): Promise<UserProfile> {
      const id = makeId("user");
      const now = new Date().toISOString();
      const profile: UserProfile = {
        id,
        email: input.email,
        displayName: input.displayName,
        isCreator: input.isCreator,
        createdAt: now,
      };
      state.users.set(id, { ...profile, passwordHash: input.passwordHash });
      state.emails.set(input.email.toLowerCase(), id);
      return profile;
    },
    async getById(id) {
      const u = state.users.get(id);
      if (!u) return null;
      const { passwordHash, ...rest } = u;
      void passwordHash;
      return rest;
    },
    async getByEmail(email) {
      const id = state.emails.get(email.toLowerCase());
      if (!id) return null;
      const u = state.users.get(id);
      return u ? { ...u } : null;
    },
    async setStripeCustomerId(userId, customerId) {
      // Tracked on the entitlement snapshot in this fake.
      const ent = state.entitlements.get(userId);
      if (ent) ent.stripeCustomerId = customerId;
    },
  };

  const entitlements: EntitlementRepo = {
    async get(userId) {
      return state.entitlements.get(userId) ?? null;
    },
    async upsert(userId, snapshot) {
      state.entitlements.set(userId, { ...snapshot });
      return { ...snapshot };
    },
    async startTrialIfMissing(userId, days) {
      const existing = state.entitlements.get(userId);
      if (existing) return { ...existing };
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      const snap: EntitlementSnapshot = {
        tier: "trialing",
        trialStartedAt: now.toISOString(),
        trialEndsAt: end.toISOString(),
        subscriptionActive: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeStatus: null,
        currentPeriodEnd: null,
        aiRunsLimitDay: 50,
      };
      state.entitlements.set(userId, snap);
      return { ...snap };
    },
  };

  const tasks: TaskRepo = {
    async list(userId) {
      return Array.from(state.tasks.values())
        .filter((t) => t.userId === userId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map(stripUserId);
    },
    async get(userId, taskId) {
      const t = state.tasks.get(taskId);
      if (!t || t.userId !== userId) return null;
      return stripUserId(t);
    },
    async create(userId, input: TaskCreateInput) {
      const now = new Date().toISOString();
      const text = input.sourceText.trim();
      const provisionalTitle = text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task";
      const task: Task = {
        id: makeId("task"),
        sourceText: text,
        sourceContext: input.sourceContext?.trim() || null,
        title: provisionalTitle,
        description: input.sourceContext?.trim() || null,
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
      state.tasks.set(task.id, { ...task, userId });
      return task;
    },
    async update(userId, taskId, patch, opts) {
      const existing = state.tasks.get(taskId);
      if (!existing || existing.userId !== userId) return null;
      const editedFields = opts?.editedFields
        ? Array.from(new Set([...existing.editedFields, ...opts.editedFields]))
        : existing.editedFields;
      const next: Task & { userId: string } = {
        ...existing,
        ...patch,
        editedFields,
        updatedAt: new Date().toISOString(),
        userId,
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
      if (patch.lifecycle === "done" && !existing.completedAt) {
        next.completedAt = next.updatedAt;
      }
      if (patch.lifecycle && patch.lifecycle !== "done") {
        next.completedAt = null;
      }
      state.tasks.set(taskId, next);
      return stripUserId(next);
    },
    async delete(userId, taskId) {
      const existing = state.tasks.get(taskId);
      if (!existing || existing.userId !== userId) return false;
      state.tasks.delete(taskId);
      return true;
    },
    async addSubtask(userId, taskId, subtask: Subtask) {
      const existing = state.tasks.get(taskId);
      if (!existing || existing.userId !== userId) return null;
      const updated: Task & { userId: string } = {
        ...existing,
        subtasks: [...existing.subtasks, subtask],
        updatedAt: new Date().toISOString(),
      };
      state.tasks.set(taskId, updated);
      return stripUserId(updated);
    },
    async toggleSubtask(userId, taskId, subtaskId) {
      const existing = state.tasks.get(taskId);
      if (!existing || existing.userId !== userId) return null;
      const updated: Task & { userId: string } = {
        ...existing,
        subtasks: existing.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)),
        updatedAt: new Date().toISOString(),
      };
      state.tasks.set(taskId, updated);
      return stripUserId(updated);
    },
    async removeSubtask(userId, taskId, subtaskId) {
      const existing = state.tasks.get(taskId);
      if (!existing || existing.userId !== userId) return null;
      const updated: Task & { userId: string } = {
        ...existing,
        subtasks: existing.subtasks.filter((s) => s.id !== subtaskId),
        updatedAt: new Date().toISOString(),
      };
      state.tasks.set(taskId, updated);
      return stripUserId(updated);
    },
  };

  const memories: MemoryRepo = {
    async list(userId) {
      return Array.from(state.memories.values())
        .filter((m) => m.userId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(({ userId: _u, ...rest }) => rest);
    },
    async create(userId, text) {
      const m: Memory & { userId: string } = {
        id: makeId("mem"),
        text,
        kind: "preference",
        pinned: false,
        createdAt: new Date().toISOString(),
        userId,
      };
      state.memories.set(m.id, m);
      const { userId: _u, ...rest } = m;
      return rest;
    },
    async update(userId, id, patch) {
      const existing = state.memories.get(id);
      if (!existing || existing.userId !== userId) return null;
      const next = { ...existing, ...patch, userId };
      state.memories.set(id, next);
      const { userId: _u, ...rest } = next;
      return rest;
    },
    async delete(userId, id) {
      const existing = state.memories.get(id);
      if (!existing || existing.userId !== userId) return false;
      state.memories.delete(id);
      return true;
    },
  };

  const aiRuns: AiRunRepo = {
    async insert(input: AiRunWriteInput) {
      const id = nanoid(12);
      const createdAt = new Date().toISOString();
      state.aiRuns.push({ id, ...input, createdAt });
      return { id, createdAt };
    },
    async countSucceededToday(userId, now = new Date()) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const start = dayStart.getTime();
      return state.aiRuns.filter(
        (r) =>
          r.userId === userId &&
          r.status === "succeeded" &&
          !r.offline &&
          Date.parse(r.createdAt) >= start,
      ).length;
    },
    async list(userId, limit = 50) {
      return state.aiRuns
        .filter((r) => r.userId === userId)
        .slice(-limit)
        .reverse();
    },
  };

  const sessions: SessionRepo = {
    async create(userId, ttlMs) {
      const id = nanoid(32);
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      state.sessions.set(id, { userId, expiresAt });
      return { id, expiresAt };
    },
    async get(id) {
      const s = state.sessions.get(id);
      if (!s) return null;
      if (Date.parse(s.expiresAt) < Date.now()) {
        state.sessions.delete(id);
        return null;
      }
      return { ...s };
    },
    async delete(id) {
      state.sessions.delete(id);
    },
  };

  const stripeEvents: StripeEventRepo = {
    async recordIfNew(eventId) {
      if (state.stripeEvents.has(eventId)) return false;
      state.stripeEvents.add(eventId);
      return true;
    },
  };

  return {
    users,
    entitlements,
    tasks,
    memories,
    aiRuns,
    sessions,
    stripeEvents,
    __reset: () => {
      state = emptyState();
    },
    __state: () => state,
  };
}

function stripUserId<T extends { userId: string }>(row: T): Omit<T, "userId"> {
  const { userId: _u, ...rest } = row;
  return rest as Omit<T, "userId">;
}
