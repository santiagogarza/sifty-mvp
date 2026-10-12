import { bucketFromScalars } from "@/lib/domain/priority";
import type {
  Decision,
  Execution,
  ExecutionStatus,
  ExecutionStep,
  Label,
  Memory,
  Subtask,
  Task,
  TaskEditableField,
  UserProfile,
} from "@/lib/domain/types";
import { emptySnapshot, trialSnapshot } from "@/lib/entitlements/entitlements";
import { id as makeId } from "@/lib/utils/ids";
import { nanoid } from "nanoid";
import {
  type AiRunRepo,
  type AiRunRollupRow,
  type AiRunWriteInput,
  DAILY_PLAN_LEASE_MS,
  type DailyPlanRecord,
  type DailyPlanRepo,
  type DecisionCreateInput,
  type DecisionRepo,
  type EntitlementRepo,
  type EntitlementSnapshot,
  type ExecutionBudgetUsage,
  type ExecutionPolicyRecord,
  type ExecutionPolicyRepo,
  type ExecutionRepo,
  IdConflictError,
  type InviteCode,
  type InviteCodeRepo,
  type InviteRedemption,
  type LabelRepo,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type MemoryCreateInput,
  type MemoryRepo,
  NOTIFICATION_CLAIM_LEASE_MS,
  type NotificationPreferencesRecord,
  type NotificationPreferencesRepo,
  type NotificationSendRecord,
  type NotificationSendRepo,
  type PushSubscriptionRecord,
  type PushSubscriptionRepo,
  type Repos,
  SIFT_ACCOUNTING_STAGE,
  type StripeEventRepo,
  type TaskCreateInput,
  type TaskEventRecord,
  type TaskEventRepo,
  type TaskRepo,
  type UserCreateInput,
  type UserRepo,
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
  users: Map<string, UserProfile>;
  emails: Map<string, string>; // lowercased email → user id
  entitlements: Map<string, EntitlementSnapshot>;
  stripeCustomers: Map<string, string>; // user id → Stripe customer id (lives on `users` in Postgres)
  tasks: Map<string, Task & { userId: string }>;
  labels: Map<string, Label & { userId: string }>;
  memories: Map<string, Memory & { userId: string }>;
  decisions: Map<string, Decision & { userId: string }>;
  aiRuns: Array<{
    id: string;
    userId: string;
    taskId: string | null;
    promptVersion: string;
    stage: string | null;
    siftId: string | null;
    workflowRunId: string | null;
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
  taskEvents: Array<TaskEventRecord & { userId: string }>;
  stripeEvents: Set<string>;
  inviteCodes: Map<string, InviteCode>;
  inviteRedemptions: InviteRedemption[];
  notificationPreferences: Map<string, NotificationPreferencesRecord>;
  pushSubscriptions: Map<string, PushSubscriptionRecord>;
  notificationSends: NotificationSendRecord[];
  dailyPlans: Map<string, DailyPlanRecord>;
  executions: Map<string, Execution & { userId: string }>;
  executionSteps: Array<ExecutionStep & { userId: string }>;
  executionPolicies: Map<string, ExecutionPolicyRecord & { userId: string }>;
}

function emptyState(): State {
  return {
    users: new Map(),
    emails: new Map(),
    entitlements: new Map(),
    stripeCustomers: new Map(),
    tasks: new Map(),
    labels: new Map(),
    memories: new Map(),
    decisions: new Map(),
    aiRuns: [],
    taskEvents: [],
    stripeEvents: new Set(),
    inviteCodes: new Map(),
    inviteRedemptions: [],
    notificationPreferences: new Map(),
    pushSubscriptions: new Map(),
    notificationSends: [],
    dailyPlans: new Map(),
    executions: new Map(),
    executionSteps: [],
    executionPolicies: new Map(),
  };
}

const TERMINAL_EXECUTION_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

/** First instant of the UTC calendar month containing `now`. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The rows caps count: a legacy single-shot run, or the `sift` accounting
 * row of a workflow sift. Per-stage rows carry cost detail only.
 */
function isBillingUnit(r: { siftId: string | null; stage: string | null }): boolean {
  return r.siftId === null || r.stage === SIFT_ACCOUNTING_STAGE;
}

/**
 * Open and not past its deadline. The asking run closes an ignored
 * question when its 7-day sleep fires; when that run is gone (deploy,
 * failure), the deadline still hides the row from the inbox and the badge.
 */
function isLive(d: Decision, now = Date.now()): boolean {
  return d.status === "open" && (d.expiresAt === null || Date.parse(d.expiresAt) > now);
}

export interface MemoryReposHandle extends Repos {
  __reset(): void;
  __state(): Readonly<State>;
}

export function createMemoryRepos(): MemoryReposHandle {
  let state = emptyState();

  const users: UserRepo = {
    async create(input: UserCreateInput): Promise<UserProfile> {
      const id = input.id ?? makeId("user");
      const now = new Date().toISOString();
      const profile: UserProfile = {
        id,
        email: input.email,
        displayName: input.displayName,
        isCreator: input.isCreator,
        createdAt: now,
      };
      state.users.set(id, profile);
      state.emails.set(input.email.toLowerCase(), id);
      return profile;
    },
    async getById(id) {
      const u = state.users.get(id);
      return u ? { ...u } : null;
    },
    async getByEmail(email) {
      const id = state.emails.get(email.toLowerCase());
      if (!id) return null;
      const u = state.users.get(id);
      return u ? { ...u } : null;
    },
    async setCreator(userId, isCreator) {
      const u = state.users.get(userId);
      if (u) state.users.set(userId, { ...u, isCreator });
    },
    async setStripeCustomerId(userId, customerId) {
      state.stripeCustomers.set(userId, customerId);
      const ent = state.entitlements.get(userId);
      if (ent) ent.stripeCustomerId = customerId;
    },
    async findByStripeCustomerId(customerId) {
      for (const [userId, cid] of state.stripeCustomers) {
        if (cid !== customerId) continue;
        const u = state.users.get(userId);
        if (u) return { ...u };
      }
      return null;
    },
    async list(limit, afterId) {
      return Array.from(state.users.values())
        .filter((u) => afterId === undefined || u.id > afterId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, limit)
        .map((u) => ({ ...u }));
    },
    async delete(userId) {
      const user = state.users.get(userId);
      if (!user) return false;
      // Mirrors the Postgres ON DELETE CASCADE chain from users.
      state.users.delete(userId);
      state.emails.delete(user.email.toLowerCase());
      state.entitlements.delete(userId);
      for (const [id, p] of state.dailyPlans) if (p.userId === userId) state.dailyPlans.delete(id);
      for (const [id, t] of state.tasks) if (t.userId === userId) state.tasks.delete(id);
      for (const [id, l] of state.labels) if (l.userId === userId) state.labels.delete(id);
      for (const [id, m] of state.memories) if (m.userId === userId) state.memories.delete(id);
      for (const [id, d] of state.decisions) if (d.userId === userId) state.decisions.delete(id);
      for (const [id, e] of state.executions) if (e.userId === userId) state.executions.delete(id);
      state.executionSteps = state.executionSteps.filter((s) => s.userId !== userId);
      for (const [k, p] of state.executionPolicies) {
        if (p.userId === userId) state.executionPolicies.delete(k);
      }
      state.aiRuns = state.aiRuns.filter((r) => r.userId !== userId);
      state.taskEvents = state.taskEvents.filter((e) => e.userId !== userId);
      state.inviteRedemptions = state.inviteRedemptions.filter((r) => r.userId !== userId);
      state.stripeCustomers.delete(userId);
      state.notificationPreferences.delete(userId);
      for (const [id, s] of state.pushSubscriptions) {
        if (s.userId === userId) state.pushSubscriptions.delete(id);
      }
      state.notificationSends = state.notificationSends.filter((s) => s.userId !== userId);
      return true;
    },
  };

  const entitlements: EntitlementRepo = {
    async get(userId) {
      const ent = state.entitlements.get(userId);
      if (!ent) return null;
      return {
        ...ent,
        stripeCustomerId: ent.stripeCustomerId ?? state.stripeCustomers.get(userId) ?? null,
      };
    },
    async upsert(userId, snapshot) {
      state.entitlements.set(userId, { ...snapshot });
      if (snapshot.stripeCustomerId) state.stripeCustomers.set(userId, snapshot.stripeCustomerId);
      return { ...snapshot };
    },
    async update(userId, mutate) {
      const current = state.entitlements.get(userId);
      const next = mutate(current ? { ...current } : null);
      state.entitlements.set(userId, { ...next });
      if (next.stripeCustomerId) state.stripeCustomers.set(userId, next.stripeCustomerId);
      return { ...next };
    },
    async startTrialIfMissing(userId, days) {
      const existing = state.entitlements.get(userId);
      if (existing) return { ...existing };
      const snap = trialSnapshot(days);
      state.entitlements.set(userId, snap);
      return { ...snap };
    },
    async listExpiredGracePeriods(now, limit) {
      return Array.from(state.entitlements.entries())
        .filter(([, e]) => e.graceEndsAt && Date.parse(e.graceEndsAt) <= now.getTime())
        .sort(([, a], [, b]) => Date.parse(a.graceEndsAt!) - Date.parse(b.graceEndsAt!))
        .slice(0, limit)
        .map(([userId]) => userId);
    },
  };

  const tasks: TaskRepo = {
    async list(userId, opts = {}) {
      const byDue = opts.orderBy === "due";
      return Array.from(state.tasks.values())
        .filter(
          (t) =>
            t.userId === userId &&
            (!opts.lifecycles || opts.lifecycles.includes(t.lifecycle)) &&
            (opts.dueOnOrBefore === undefined || (t.due !== null && t.due <= opts.dueOnOrBefore)) &&
            (!byDue || t.due !== null),
        )
        .sort((a, b) =>
          byDue
            ? a.due!.localeCompare(b.due!) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        )
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async get(userId, taskId) {
      const t = state.tasks.get(taskId);
      if (!t || t.userId !== userId) return null;
      return stripUserId(t);
    },
    async create(userId, input: TaskCreateInput) {
      if (input.id) {
        const existing = state.tasks.get(input.id);
        if (existing && existing.userId !== userId) {
          throw new IdConflictError(input.id);
        }
        if (existing) return stripUserId(existing);
      }
      const now = input.createdAt ?? new Date().toISOString();
      const text = input.sourceText.trim();
      const provisionalTitle = text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task";
      const task: Task = {
        id: input.id ?? makeId("task"),
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
        assigneeName: null,
        confidence: 0,
        clarifyingQuestion: null,
        rationale: null,
        agentBrief: null,
        siftId: null,
        siftStage: null,
        plan: null,
        siftedWithAssumptions: false,
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
      if (opts && "ifSiftId" in opts && existing.siftId !== (opts.ifSiftId ?? null)) return null;
      const editedFields = opts?.editedFields
        ? Array.from(new Set([...existing.editedFields, ...opts.editedFields]))
        : existing.editedFields;
      // Mirror the Postgres behavior: only labels this user owns are linked.
      const scopedPatch = { ...patch };
      if (scopedPatch.labelIds) {
        scopedPatch.labelIds = scopedPatch.labelIds.filter((id) => {
          const label = state.labels.get(id);
          return !!label && label.userId === userId;
        });
      }
      const next: Task & { userId: string } = {
        ...existing,
        ...scopedPatch,
        editedFields,
        updatedAt: new Date().toISOString(),
        userId,
      };
      // Recompute the derived bucket from the scalars unless the caller set
      // it explicitly or the user has protected it with a manual edit.
      if (
        ("urgency" in patch || "importance" in patch) &&
        !("priorityBucket" in patch) &&
        !editedFields.includes("priorityBucket")
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
      // Mirrors `decisions.task_id` / `executions.task_id ON DELETE CASCADE`.
      for (const [id, d] of state.decisions) if (d.taskId === taskId) state.decisions.delete(id);
      for (const [id, e] of state.executions) {
        if (e.taskId !== taskId) continue;
        state.executions.delete(id);
        state.executionSteps = state.executionSteps.filter((s) => s.executionId !== id);
      }
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

  const labels: LabelRepo = {
    async list(userId, opts = {}) {
      return Array.from(state.labels.values())
        .filter((l) => l.userId === userId)
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async listByIds(userId, ids) {
      return Array.from(state.labels.values())
        .filter((l) => l.userId === userId && ids.includes(l.id))
        .map(stripUserId);
    },
    async findByNames(userId, names) {
      const wanted = new Set(names.map((n) => n.toLowerCase()));
      return Array.from(state.labels.values())
        .filter((l) => l.userId === userId && wanted.has(l.name.toLowerCase()))
        .map(stripUserId);
    },
    async ensure(userId, input) {
      const existing = Array.from(state.labels.values()).find(
        (l) => l.userId === userId && l.name.toLowerCase() === input.name.toLowerCase(),
      );
      if (existing) return stripUserId(existing);
      // Never let a suggested id claim or clobber an existing row (it may
      // belong to another tenant); mint a fresh one instead.
      const id = state.labels.has(input.id) ? makeId("label") : input.id;
      const label: Label & { userId: string } = {
        id,
        name: input.name,
        tone: input.tone,
        userId,
      };
      state.labels.set(label.id, label);
      return stripUserId(label);
    },
  };

  const memories: MemoryRepo = {
    async list(userId, opts = {}) {
      return Array.from(state.memories.values())
        .filter(
          (m) => m.userId === userId && (opts.pinned === undefined || m.pinned === opts.pinned),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, opts.limit)
        .map(({ userId: _u, ...rest }) => rest);
    },
    async create(userId, input: MemoryCreateInput) {
      if (input.id) {
        const existing = state.memories.get(input.id);
        if (existing && existing.userId !== userId) {
          throw new IdConflictError(input.id);
        }
        if (existing) {
          const { userId: _u, ...rest } = existing;
          return rest;
        }
      }
      const m: Memory & { userId: string } = {
        id: input.id ?? makeId("mem"),
        text: input.text,
        kind: input.kind ?? "preference",
        pinned: input.pinned ?? false,
        createdAt: input.createdAt ?? new Date().toISOString(),
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

  const decisions: DecisionRepo = {
    async create(userId, input: DecisionCreateInput) {
      if (input.id) {
        const existing = state.decisions.get(input.id);
        if (existing && existing.userId !== userId) throw new IdConflictError(input.id);
        if (existing) return stripUserId(existing);
      }
      const now = new Date().toISOString();
      const decision: Decision & { userId: string } = {
        id: input.id ?? makeId("dec"),
        kind: input.kind,
        status: "open",
        taskId: input.taskId,
        payload: input.payload,
        answer: null,
        resumeToken: input.resumeToken,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
        expiresAt: input.expiresAt,
        userId,
      };
      state.decisions.set(decision.id, decision);
      return stripUserId(decision);
    },
    async get(userId, id) {
      const d = state.decisions.get(id);
      if (!d || d.userId !== userId) return null;
      return stripUserId(d);
    },
    async listOpen(userId, opts) {
      return Array.from(state.decisions.values())
        .filter((d) => d.userId === userId && isLive(d))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async countOpen(userId) {
      let n = 0;
      for (const d of state.decisions.values()) if (d.userId === userId && isLive(d)) n++;
      return n;
    },
    async listOpenForTask(userId, taskId, opts) {
      return Array.from(state.decisions.values())
        .filter((d) => d.userId === userId && d.status === "open" && d.taskId === taskId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async listByKind(userId, kind, opts) {
      return Array.from(state.decisions.values())
        .reverse()
        .filter((d) => d.userId === userId && d.kind === kind)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async resolve(userId, id, input) {
      const d = state.decisions.get(id);
      if (!d || d.userId !== userId || d.status !== "open") return null;
      const now = new Date().toISOString();
      const next = {
        ...d,
        status: input.status,
        answer: input.answer,
        resolvedAt: now,
        updatedAt: now,
      };
      state.decisions.set(id, next);
      return stripUserId(next);
    },
  };

  const aiRuns: AiRunRepo = {
    async insert(input: AiRunWriteInput) {
      const id = nanoid(12);
      const createdAt = new Date().toISOString();
      state.aiRuns.push({
        id,
        ...input,
        stage: input.stage ?? null,
        siftId: input.siftId ?? null,
        workflowRunId: input.workflowRunId ?? null,
        createdAt,
      });
      return { id, createdAt };
    },
    async setStatus(userId, id, status, error) {
      const run = state.aiRuns.find((r) => r.id === id && r.userId === userId);
      if (!run) return;
      run.status = status;
      if (error !== undefined) run.error = error;
    },
    async complete(userId, id, patch) {
      const run = state.aiRuns.find((r) => r.id === id && r.userId === userId);
      if (!run) return;
      Object.assign(run, patch);
    },
    async countSucceededToday(userId, now = new Date()) {
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const start = dayStart.getTime();
      return state.aiRuns.filter(
        (r) =>
          r.userId === userId &&
          isBillingUnit(r) &&
          r.status === "succeeded" &&
          !r.offline &&
          Date.parse(r.createdAt) >= start,
      ).length;
    },
    async countSince(userId, since) {
      const start = since.getTime();
      return state.aiRuns.filter(
        (r) => r.userId === userId && isBillingUnit(r) && Date.parse(r.createdAt) >= start,
      ).length;
    },
    async list(userId, limit) {
      const mine = state.aiRuns.filter((r) => r.userId === userId);
      // Same projection as the Postgres mapper: no tenant id — this shape
      // is what the data export ships.
      return (limit === undefined ? mine : mine.slice(-limit))
        .reverse()
        .map(({ userId: _u, ...record }) => record);
    },
    async rollup({ since, by }) {
      const start = since.getTime();
      const groups = new Map<string, AiRunRollupRow>();
      for (const r of state.aiRuns) {
        if (Date.parse(r.createdAt) < start) continue;
        const key =
          by === "day"
            ? r.createdAt.slice(0, 10)
            : by === "stage"
              ? (r.stage ?? "legacy")
              : by === "model"
                ? r.model
                : r.userId;
        const row = groups.get(key) ?? {
          key,
          runs: 0,
          failed: 0,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
        };
        row.runs += 1;
        if (r.status === "failed") row.failed += 1;
        row.inputTokens += r.inputTokens ?? 0;
        row.outputTokens += r.outputTokens ?? 0;
        row.costCents += r.costCents ?? 0;
        groups.set(key, row);
      }
      return Array.from(groups.values()).sort((a, b) =>
        by === "day" ? b.key.localeCompare(a.key) : b.costCents - a.costCents || b.runs - a.runs,
      );
    },
  };

  const taskEvents: TaskEventRepo = {
    async list(userId, limit) {
      const mine = state.taskEvents.filter((e) => e.userId === userId);
      return (limit === undefined ? mine : mine.slice(0, limit)).map(stripUserId);
    },
    async listForTask(userId, taskId, limit) {
      return state.taskEvents
        .filter((e) => e.userId === userId && e.taskId === taskId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, limit)
        .map(stripUserId);
    },
    async append(userId, input) {
      if (input.id) {
        const existing = state.taskEvents.find((e) => e.id === input.id);
        if (existing && existing.userId !== userId) throw new IdConflictError(input.id);
        if (existing) return stripUserId(existing);
      }
      const event = {
        id: input.id ?? makeId("evt"),
        userId,
        taskId: input.taskId,
        kind: input.kind,
        payload: { ...input.payload },
        createdAt: new Date().toISOString(),
      };
      state.taskEvents.push(event);
      return stripUserId(event);
    },
  };

  const dailyPlans: DailyPlanRepo = {
    async claim(input, now = new Date()) {
      // Single-threaded, so check-then-insert is atomic here; Postgres takes
      // a per-user advisory lock for the same guarantee.
      const running = await dailyPlans.runningFor(input.userId, now);
      if (running) return { ok: false, reason: "running", plan: running };
      if (input.trigger === "cron") {
        for (const p of state.dailyPlans.values()) {
          if (p.userId === input.userId && p.planDate === input.planDate && p.trigger === "cron") {
            return { ok: false, reason: "planned" };
          }
        }
      }
      const plan: DailyPlanRecord = {
        id: makeId("plan"),
        userId: input.userId,
        planDate: input.planDate,
        timezone: input.timezone,
        trigger: input.trigger,
        status: "running",
        workflowRunId: null,
        aiRunId: input.aiRunId,
        summary: null,
        moves: [],
        considered: 0,
        error: null,
        createdAt: now.toISOString(),
        finishedAt: null,
      };
      state.dailyPlans.set(plan.id, plan);
      return { ok: true, plan: { ...plan, moves: [...plan.moves] } };
    },
    async get(userId, id) {
      const p = state.dailyPlans.get(id);
      return p && p.userId === userId ? { ...p, moves: [...p.moves] } : null;
    },
    async latest(userId) {
      // Reverse before the (stable) sort so same-millisecond rows come out
      // newest-inserted first, like Postgres's microsecond timestamps would.
      const mine = Array.from(state.dailyPlans.values())
        .reverse()
        .filter((p) => p.userId === userId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return mine[0] ? { ...mine[0], moves: [...mine[0].moves] } : null;
    },
    async runningFor(userId, now = new Date()) {
      const since = now.getTime() - DAILY_PLAN_LEASE_MS;
      const running = Array.from(state.dailyPlans.values())
        .reverse()
        .filter(
          (p) => p.userId === userId && p.status === "running" && Date.parse(p.createdAt) > since,
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return running[0] ? { ...running[0], moves: [...running[0].moves] } : null;
    },
    async update(userId, id, patch) {
      const existing = state.dailyPlans.get(id);
      if (!existing || existing.userId !== userId) return null;
      const next: DailyPlanRecord = {
        ...existing,
        ...patch,
        finishedAt: patch.finishedAt === undefined ? existing.finishedAt : patch.finishedAt,
        moves: patch.moves ? patch.moves.map((m) => ({ ...m })) : existing.moves,
      };
      state.dailyPlans.set(id, next);
      return { ...next, moves: [...next.moves] };
    },
  };

  const stripeEvents: StripeEventRepo = {
    async recordIfNew(eventId) {
      if (state.stripeEvents.has(eventId)) return false;
      state.stripeEvents.add(eventId);
      return true;
    },
    async delete(eventId) {
      state.stripeEvents.delete(eventId);
    },
  };

  const inviteCodes: InviteCodeRepo = {
    async create(input) {
      const code: InviteCode = {
        id: makeId("inv"),
        ...input,
        redemptionCount: 0,
        revokedAt: null,
        createdAt: new Date().toISOString(),
      };
      state.inviteCodes.set(code.id, code);
      return { ...code };
    },
    async findByHash(codeHash) {
      for (const c of state.inviteCodes.values()) {
        if (c.codeHash === codeHash) return { ...c };
      }
      return null;
    },
    async getById(id) {
      const c = state.inviteCodes.get(id);
      return c ? { ...c } : null;
    },
    async list() {
      return Array.from(state.inviteCodes.values())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((c) => ({ ...c }));
    },
    async revoke(id, at = new Date()) {
      const c = state.inviteCodes.get(id);
      if (!c) return null;
      if (!c.revokedAt) c.revokedAt = at.toISOString();
      return { ...c };
    },
    async consume(codeId, userId, input) {
      // The memory store is single-threaded, so this block is atomic by
      // construction; the Postgres implementation gets the same guarantee
      // from a row lock and a conditional UPDATE inside one transaction.
      const now = input.now ?? new Date();
      const c = state.inviteCodes.get(codeId);
      if (!c) return { ok: false, reason: "expired" };
      if (state.inviteRedemptions.some((r) => r.codeId === codeId && r.userId === userId)) {
        return { ok: false, reason: "already_redeemed" };
      }
      if (c.revokedAt) return { ok: false, reason: "revoked" };
      if (c.expiresAt && Date.parse(c.expiresAt) <= now.getTime()) {
        return { ok: false, reason: "expired" };
      }
      if (c.redemptionCount >= c.maxRedemptions) return { ok: false, reason: "exhausted" };

      const current = state.entitlements.get(userId) ?? null;
      const grant = input.grant(current ? { ...current } : null);
      const next: EntitlementSnapshot = {
        ...(current ?? emptySnapshot()),
        compedAt: grant.compedAt,
        compedUntil: grant.compedUntil,
        tier: grant.tier,
      };

      c.redemptionCount += 1;
      const redemption: InviteRedemption = {
        id: makeId("red"),
        codeId,
        userId,
        compedUntil: grant.compedUntil,
        redeemedAt: now.toISOString(),
      };
      state.inviteRedemptions.push(redemption);
      state.entitlements.set(userId, next);
      return { ok: true, redemption: { ...redemption }, entitlement: { ...next } };
    },
    async listRedemptions(codeId) {
      return state.inviteRedemptions.filter((r) => r.codeId === codeId).map((r) => ({ ...r }));
    },
    async listRedemptionsForUser(userId) {
      return state.inviteRedemptions.filter((r) => r.userId === userId).map((r) => ({ ...r }));
    },
  };

  const notificationPreferences: NotificationPreferencesRepo = {
    async get(userId) {
      const row = state.notificationPreferences.get(userId);
      return row ? { ...row } : null;
    },
    async upsert(userId, input) {
      const row: NotificationPreferencesRecord = {
        ...input,
        userId,
        updatedAt: new Date().toISOString(),
      };
      state.notificationPreferences.set(userId, row);
      return { ...row };
    },
    async list(limit, afterUserId) {
      return Array.from(state.notificationPreferences.values())
        .filter((p) => (afterUserId ? p.userId > afterUserId : true))
        .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
        .slice(0, limit)
        .map((p) => ({ ...p }));
    },
  };

  const pushSubscriptions: PushSubscriptionRepo = {
    async listForUser(userId) {
      return Array.from(state.pushSubscriptions.values())
        .filter((s) => s.userId === userId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .slice(0, MAX_PUSH_SUBSCRIPTIONS_PER_USER)
        .map((s) => ({ ...s }));
    },
    async upsert(userId, input) {
      const existing = Array.from(state.pushSubscriptions.values()).find(
        (s) => s.endpoint === input.endpoint,
      );
      const row: PushSubscriptionRecord = {
        id: existing?.id ?? makeId("push"),
        userId,
        ...input,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        lastUsedAt: existing?.userId === userId ? existing.lastUsedAt : null,
      };
      state.pushSubscriptions.set(row.id, row);
      return { ...row };
    },
    async deleteByEndpoint(userId, endpoint) {
      for (const [id, s] of state.pushSubscriptions) {
        if (s.userId === userId && s.endpoint === endpoint) {
          state.pushSubscriptions.delete(id);
          return true;
        }
      }
      return false;
    },
    async remove(id) {
      state.pushSubscriptions.delete(id);
    },
    async touch(id, at) {
      const s = state.pushSubscriptions.get(id);
      if (s) s.lastUsedAt = at.toISOString();
    },
  };

  const notificationSends: NotificationSendRepo = {
    async claim(input, now = new Date()) {
      const existing = state.notificationSends.find(
        (s) =>
          s.userId === input.userId &&
          s.kind === input.kind &&
          s.channel === input.channel &&
          s.periodKey === input.periodKey,
      );
      if (existing) {
        const expired =
          existing.status === "pending" &&
          Date.parse(existing.createdAt) < now.getTime() - NOTIFICATION_CLAIM_LEASE_MS;
        if (!expired) return null;
        existing.createdAt = now.toISOString();
        existing.error = null;
        return { id: existing.id };
      }
      const row: NotificationSendRecord = {
        id: makeId("send"),
        ...input,
        status: "pending",
        error: null,
        createdAt: now.toISOString(),
        sentAt: null,
      };
      state.notificationSends.push(row);
      return { id: row.id };
    },
    async finalize(id, outcome) {
      const row = state.notificationSends.find((s) => s.id === id);
      if (!row) return;
      row.status = outcome.status;
      row.error = outcome.error ?? null;
      row.sentAt = outcome.status === "sent" ? new Date().toISOString() : null;
    },
    async listForUser(userId, limit) {
      const mine = state.notificationSends
        .filter((s) => s.userId === userId)
        .slice()
        .reverse()
        .map((s) => ({ ...s }));
      return limit === undefined ? mine : mine.slice(0, limit);
    },
  };

  const cloneExecution = (e: Execution & { userId: string }): Execution => {
    const { userId: _u, ...rest } = e;
    return {
      ...rest,
      answers: [...rest.answers],
      result: rest.result
        ? { ...rest.result, draft: rest.result.draft ? { ...rest.result.draft } : null }
        : null,
    };
  };

  const usageFor = (userId: string, now: Date): ExecutionBudgetUsage => {
    const start = monthStartUtc(now).getTime();
    const usage: ExecutionBudgetUsage = { committedCents: 0, reservedCents: 0 };
    for (const e of state.executions.values()) {
      if (e.userId !== userId || Date.parse(e.createdAt) < start) continue;
      usage.committedCents += e.costCents;
      usage.reservedCents += e.reservedCents;
    }
    return usage;
  };

  const executions: ExecutionRepo = {
    async create(userId, input) {
      // No await before the insert: the replay and live checks and the
      // write are one tick, like the locked transaction in Postgres.
      for (const e of state.executions.values()) {
        if (e.userId === userId && e.idempotencyKey === input.idempotencyKey) {
          return { created: false, reason: "replay", execution: cloneExecution(e) };
        }
      }
      if (input.id) {
        const existing = state.executions.get(input.id);
        if (existing && existing.userId !== userId) throw new IdConflictError(input.id);
        if (existing)
          return { created: false, reason: "replay", execution: cloneExecution(existing) };
      }
      for (const e of state.executions.values()) {
        if (
          e.userId === userId &&
          e.taskId === input.taskId &&
          !TERMINAL_EXECUTION_STATUSES.has(e.status)
        ) {
          return { created: false, reason: "live", execution: cloneExecution(e) };
        }
      }
      const now = new Date().toISOString();
      const execution: Execution & { userId: string } = {
        id: input.id ?? makeId("exec"),
        userId,
        taskId: input.taskId,
        status: "queued",
        executor: input.executor,
        policy: input.policy,
        connector: input.connector,
        idempotencyKey: input.idempotencyKey,
        workflowRunId: null,
        decisionId: null,
        reservedCents: 0,
        costCents: 0,
        result: null,
        answers: [],
        error: null,
        cancelReason: null,
        cancelRequested: false,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        updatedAt: now,
      };
      state.executions.set(execution.id, execution);
      return { created: true, execution: cloneExecution(execution) };
    },
    async get(userId, id) {
      const e = state.executions.get(id);
      return e && e.userId === userId ? cloneExecution(e) : null;
    },
    async listForTask(userId, taskId, opts) {
      return Array.from(state.executions.values())
        .reverse()
        .filter((e) => e.userId === userId && e.taskId === taskId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, opts.limit)
        .map(cloneExecution);
    },
    async listActive(userId, opts) {
      return Array.from(state.executions.values())
        .reverse()
        .filter((e) => e.userId === userId && !TERMINAL_EXECUTION_STATUSES.has(e.status))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, opts.limit)
        .map(cloneExecution);
    },
    async transition(userId, id, input) {
      const e = state.executions.get(id);
      if (!e || e.userId !== userId || !input.from.includes(e.status)) return null;
      const next = {
        ...e,
        ...input.patch,
        status: input.to,
        updatedAt: new Date().toISOString(),
      };
      state.executions.set(id, next);
      return cloneExecution(next);
    },
    async update(userId, id, patch) {
      const e = state.executions.get(id);
      if (!e || e.userId !== userId) return null;
      const next = { ...e, ...patch, updatedAt: new Date().toISOString() };
      state.executions.set(id, next);
      return cloneExecution(next);
    },
    async reserve(userId, id, input) {
      const e = state.executions.get(id);
      if (!e || e.userId !== userId) return { ok: false, reason: "not_found" };
      const now = input.now ?? new Date();
      // No await between the read and the write, so concurrent reservations
      // serialize on the event loop; Postgres takes a per-user advisory lock
      // for the same guarantee.
      const usage = usageFor(userId, now);
      const cents = Math.ceil(input.cents);
      const projected = usage.committedCents + usage.reservedCents - e.reservedCents + cents;
      if (projected > input.capCents) return { ok: false, reason: "budget", usage };
      const next = { ...e, reservedCents: cents, updatedAt: now.toISOString() };
      state.executions.set(id, next);
      return {
        ok: true,
        execution: cloneExecution(next),
        usage: { ...usage, reservedCents: usage.reservedCents - e.reservedCents + cents },
      };
    },
    async settle(userId, id, input) {
      const e = state.executions.get(id);
      if (!e || e.userId !== userId) return null;
      const next = {
        ...e,
        reservedCents: 0,
        costCents: input.costCents,
        updatedAt: new Date().toISOString(),
      };
      state.executions.set(id, next);
      return cloneExecution(next);
    },
    async monthlyUsage(userId, now = new Date()) {
      return usageFor(userId, now);
    },
    async countByStatus(userId, input) {
      const since = input.since.getTime();
      const counts = Object.fromEntries(
        [
          "queued",
          "running",
          "needs_decision",
          "needs_approval",
          "drafted",
          "done",
          "failed",
          "cancelled",
        ].map((s) => [s, 0]),
      ) as Record<ExecutionStatus, number>;
      for (const e of state.executions.values()) {
        if (e.userId !== userId || Date.parse(e.updatedAt) < since) continue;
        counts[e.status] += 1;
      }
      return counts;
    },
    async appendStep(userId, input) {
      if (input.id) {
        const existing = state.executionSteps.find((s) => s.id === input.id);
        if (existing && existing.userId !== userId) throw new IdConflictError(input.id);
        if (existing) return stripUserId(existing);
      }
      const bySeq = state.executionSteps.find(
        (s) => s.executionId === input.executionId && s.seq === input.seq,
      );
      if (bySeq) {
        if (bySeq.userId !== userId) throw new IdConflictError(`${input.executionId}:${input.seq}`);
        return stripUserId(bySeq);
      }
      const step: ExecutionStep & { userId: string } = {
        id: input.id ?? makeId("estep"),
        userId,
        executionId: input.executionId,
        seq: input.seq,
        kind: input.kind,
        name: input.name,
        status: input.status,
        input: input.input ? { ...input.input } : null,
        output: input.output ? { ...input.output } : null,
        durationMs: input.durationMs,
        costCents: input.costCents,
        createdAt: new Date().toISOString(),
      };
      state.executionSteps.push(step);
      return stripUserId(step);
    },
    async listSteps(userId, executionId, opts) {
      return state.executionSteps
        .filter((s) => s.userId === userId && s.executionId === executionId)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, opts.limit)
        .map(stripUserId);
    },
  };

  const policyKey = (userId: string, scope: string, key: string) =>
    `${userId}\u0000${scope}\u0000${key}`;
  const executionPolicies: ExecutionPolicyRepo = {
    async get(userId, scope, key) {
      const row = state.executionPolicies.get(policyKey(userId, scope, key));
      return row ? stripUserId(row) : null;
    },
    async list(userId, scope, opts) {
      return Array.from(state.executionPolicies.values())
        .filter((p) => p.userId === userId && p.scope === scope)
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, opts.limit)
        .map(stripUserId);
    },
    async set(userId, scope, key, policy) {
      const row = { userId, scope, key, policy, updatedAt: new Date().toISOString() };
      state.executionPolicies.set(policyKey(userId, scope, key), row);
      return stripUserId(row);
    },
    async clear(userId, scope, key) {
      return state.executionPolicies.delete(policyKey(userId, scope, key));
    },
  };

  return {
    users,
    entitlements,
    tasks,
    labels,
    memories,
    decisions,
    aiRuns,
    taskEvents,
    stripeEvents,
    inviteCodes,
    notificationPreferences,
    pushSubscriptions,
    notificationSends,
    dailyPlans,
    executions,
    executionPolicies,
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
