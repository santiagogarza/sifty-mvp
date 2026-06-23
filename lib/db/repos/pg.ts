import { bucketFromScalars } from "@/lib/domain/priority";
import type { Memory, Subtask, Task, TaskEditableField } from "@/lib/domain/types";
import { id as makeId } from "@/lib/utils/ids";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import * as schema from "../schema";
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
 * Postgres-backed repository implementations.
 *
 * Tenancy invariant: every method that touches tenant data must include
 * `userId` in its predicate. The integration test in
 * `tests/db/tenancy.test.ts` enforces this against an in-memory variant —
 * the same logic structure applies here.
 */

export function createPostgresRepos(): Repos {
  const users: UserRepo = {
    async create(input: UserCreateInput) {
      const db = getDb();
      const id = makeId("user");
      const now = new Date();
      const [row] = await db
        .insert(schema.users)
        .values({
          id,
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          isCreator: input.isCreator,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return {
        id: row!.id,
        email: row!.email,
        displayName: row!.displayName,
        isCreator: row!.isCreator,
        createdAt: row!.createdAt.toISOString(),
      };
    },
    async getById(id) {
      const db = getDb();
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        isCreator: row.isCreator,
        createdAt: row.createdAt.toISOString(),
      };
    },
    async getByEmail(email) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.toLowerCase()));
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        isCreator: row.isCreator,
        createdAt: row.createdAt.toISOString(),
        passwordHash: row.passwordHash,
      };
    },
    async setStripeCustomerId(userId, customerId) {
      const db = getDb();
      await db
        .update(schema.users)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    },
    async findByStripeCustomerId(customerId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.stripeCustomerId, customerId));
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        isCreator: row.isCreator,
        createdAt: row.createdAt.toISOString(),
      };
    },
  };

  const entitlements: EntitlementRepo = {
    async get(userId) {
      const db = getDb();
      const [ent] = await db
        .select()
        .from(schema.entitlements)
        .where(eq(schema.entitlements.userId, userId));
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      if (!ent || !user) return null;
      return {
        tier: ent.tier,
        trialStartedAt: user.trialStartedAt?.toISOString() ?? null,
        trialEndsAt: ent.trialEndsAt?.toISOString() ?? null,
        subscriptionActive: ent.tier === "active" || ent.tier === "creator",
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: ent.stripeSubscriptionId,
        stripeStatus: ent.stripeStatus,
        currentPeriodEnd: ent.currentPeriodEnd?.toISOString() ?? null,
        aiRunsLimitDay: ent.aiRunsLimitDay,
      };
    },
    async upsert(userId, snapshot) {
      const db = getDb();
      await db
        .insert(schema.entitlements)
        .values({
          userId,
          tier: snapshot.tier,
          trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
          stripeSubscriptionId: snapshot.stripeSubscriptionId,
          stripeStatus: snapshot.stripeStatus,
          currentPeriodEnd: snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd) : null,
          aiRunsLimitDay: snapshot.aiRunsLimitDay,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.entitlements.userId,
          set: {
            tier: snapshot.tier,
            trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
            stripeSubscriptionId: snapshot.stripeSubscriptionId,
            stripeStatus: snapshot.stripeStatus,
            currentPeriodEnd: snapshot.currentPeriodEnd
              ? new Date(snapshot.currentPeriodEnd)
              : null,
            aiRunsLimitDay: snapshot.aiRunsLimitDay,
            updatedAt: new Date(),
          },
        });
      if (snapshot.trialStartedAt || snapshot.stripeCustomerId) {
        await db
          .update(schema.users)
          .set({
            trialStartedAt: snapshot.trialStartedAt ? new Date(snapshot.trialStartedAt) : undefined,
            stripeCustomerId: snapshot.stripeCustomerId ?? undefined,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, userId));
      }
      return { ...snapshot };
    },
    async startTrialIfMissing(userId, days) {
      const existing = await entitlements.get(userId);
      if (existing) return existing;
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      return entitlements.upsert(userId, {
        tier: "trialing",
        trialStartedAt: now.toISOString(),
        trialEndsAt: end.toISOString(),
        subscriptionActive: false,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeStatus: null,
        currentPeriodEnd: null,
        aiRunsLimitDay: 50,
      });
    },
  };

  const tasks: TaskRepo = {
    async list(userId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.userId, userId))
        .orderBy(desc(schema.tasks.updatedAt));
      return rows.map(rowToTask);
    },
    async get(userId, taskId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
      return row ? rowToTask(row) : null;
    },
    async create(userId, input: TaskCreateInput) {
      const db = getDb();
      const text = input.sourceText.trim();
      const provisionalTitle = text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task";
      const id = makeId("task");
      const now = new Date();
      const [row] = await db
        .insert(schema.tasks)
        .values({
          id,
          userId,
          sourceText: text,
          sourceContext: input.sourceContext?.trim() || null,
          title: provisionalTitle,
          description: input.sourceContext?.trim() || null,
          aiStatus: "pending",
          urgency: 40,
          importance: 40,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return rowToTask(row!);
    },
    async update(userId, taskId, patch, opts) {
      const db = getDb();
      const existing = await tasks.get(userId, taskId);
      if (!existing) return null;

      const editedFields = opts?.editedFields
        ? Array.from(new Set([...existing.editedFields, ...opts.editedFields]))
        : existing.editedFields;
      const merged = { ...existing, ...patch, editedFields } as Task;
      if (
        ("urgency" in patch ||
          "importance" in patch ||
          opts?.editedFields?.includes("urgency") ||
          opts?.editedFields?.includes("importance")) &&
        !opts?.editedFields?.includes("priorityBucket")
      ) {
        merged.priorityBucket = bucketFromScalars(merged.urgency, merged.importance);
      }
      const now = new Date();
      let completedAt = existing.completedAt ? new Date(existing.completedAt) : null;
      if (patch.lifecycle === "done" && !existing.completedAt) {
        completedAt = now;
      }
      if (patch.lifecycle && patch.lifecycle !== "done") {
        completedAt = null;
      }

      await db
        .update(schema.tasks)
        .set({
          title: merged.title,
          description: merged.description,
          nextAction: merged.nextAction,
          lifecycle: merged.lifecycle,
          aiStatus: merged.aiStatus,
          aiError: merged.aiError,
          aiAttempts: merged.aiAttempts,
          urgency: Math.round(merged.urgency * 100),
          importance: Math.round(merged.importance * 100),
          priorityBucket: merged.priorityBucket,
          effort: merged.effort,
          due: merged.due,
          delegationCandidate: merged.delegationCandidate,
          confidence: Math.round(merged.confidence * 100),
          clarifyingQuestion: merged.clarifyingQuestion,
          rationale: merged.rationale,
          editedFields: merged.editedFields,
          subtasks: merged.subtasks,
          completedAt,
          updatedAt: now,
        })
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));

      return tasks.get(userId, taskId);
    },
    async delete(userId, taskId) {
      const db = getDb();
      const result = await db
        .delete(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
      return (result as unknown as { count: number }).count > 0;
    },
    async addSubtask(userId, taskId, subtask: Subtask) {
      const existing = await tasks.get(userId, taskId);
      if (!existing) return null;
      return tasks.update(userId, taskId, {
        subtasks: [...existing.subtasks, subtask],
      });
    },
    async toggleSubtask(userId, taskId, subtaskId) {
      const existing = await tasks.get(userId, taskId);
      if (!existing) return null;
      return tasks.update(userId, taskId, {
        subtasks: existing.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s)),
      });
    },
    async removeSubtask(userId, taskId, subtaskId) {
      const existing = await tasks.get(userId, taskId);
      if (!existing) return null;
      return tasks.update(userId, taskId, {
        subtasks: existing.subtasks.filter((s) => s.id !== subtaskId),
      });
    },
  };

  const memories: MemoryRepo = {
    async list(userId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.userId, userId))
        .orderBy(desc(schema.memories.createdAt));
      return rows.map(rowToMemory);
    },
    async create(userId, text) {
      const db = getDb();
      const [row] = await db
        .insert(schema.memories)
        .values({
          id: makeId("mem"),
          userId,
          text,
          kind: "preference",
          pinned: false,
        })
        .returning();
      return rowToMemory(row!);
    },
    async update(userId, id, patch) {
      const db = getDb();
      await db
        .update(schema.memories)
        .set({
          text: patch.text,
          pinned: patch.pinned,
          kind: patch.kind,
        })
        .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)));
      const [row] = await db
        .select()
        .from(schema.memories)
        .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)));
      return row ? rowToMemory(row) : null;
    },
    async delete(userId, id) {
      const db = getDb();
      const result = await db
        .delete(schema.memories)
        .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)));
      return (result as unknown as { count: number }).count > 0;
    },
  };

  const aiRuns: AiRunRepo = {
    async insert(input: AiRunWriteInput) {
      const db = getDb();
      const id = nanoid(12);
      const createdAt = new Date();
      await db.insert(schema.aiRuns).values({
        id,
        userId: input.userId,
        taskId: input.taskId,
        promptVersion: input.promptVersion,
        model: input.model,
        transport: input.transport,
        status: input.status,
        durationMs: input.durationMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costCents: input.costCents,
        offline: input.offline,
        error: input.error,
        createdAt,
      });
      return { id, createdAt: createdAt.toISOString() };
    },
    async countSucceededToday(userId, now = new Date()) {
      const db = getDb();
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const [row] = await db
        .select({ value: count() })
        .from(schema.aiRuns)
        .where(
          and(
            eq(schema.aiRuns.userId, userId),
            eq(schema.aiRuns.status, "succeeded"),
            eq(schema.aiRuns.offline, false),
            gte(schema.aiRuns.createdAt, dayStart),
          ),
        );
      return row?.value ?? 0;
    },
    async list(userId, limit = 50) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.aiRuns)
        .where(eq(schema.aiRuns.userId, userId))
        .orderBy(desc(schema.aiRuns.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        model: r.model,
        transport: r.transport,
        status: r.status,
        durationMs: r.durationMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costCents: r.costCents,
        offline: r.offline,
        error: r.error,
        createdAt: r.createdAt.toISOString(),
      }));
    },
  };

  const sessions: SessionRepo = {
    async create(userId, ttlMs) {
      const db = getDb();
      const id = nanoid(32);
      const expiresAt = new Date(Date.now() + ttlMs);
      await db.insert(schema.sessions).values({ id, userId, expiresAt });
      return { id, expiresAt: expiresAt.toISOString() };
    },
    async get(id) {
      const db = getDb();
      const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
      if (!row) return null;
      if (row.expiresAt.getTime() < Date.now()) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
        return null;
      }
      return { userId: row.userId, expiresAt: row.expiresAt.toISOString() };
    },
    async delete(id) {
      const db = getDb();
      await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    },
  };

  const stripeEvents: StripeEventRepo = {
    async recordIfNew(eventId, type) {
      const db = getDb();
      const result = await db
        .insert(schema.stripeEvents)
        .values({ id: eventId, type })
        .onConflictDoNothing();
      return (result as unknown as { count: number }).count > 0;
    },
  };

  return { users, entitlements, tasks, memories, aiRuns, sessions, stripeEvents };
}

function rowToTask(row: typeof schema.tasks.$inferSelect): Task {
  return {
    id: row.id,
    sourceText: row.sourceText,
    sourceContext: row.sourceContext,
    title: row.title,
    description: row.description,
    nextAction: row.nextAction,
    lifecycle: row.lifecycle,
    aiStatus: row.aiStatus,
    aiError: row.aiError,
    aiAttempts: row.aiAttempts,
    urgency: row.urgency / 100,
    importance: row.importance / 100,
    priorityBucket: row.priorityBucket,
    effort: row.effort,
    due: row.due,
    delegationCandidate: row.delegationCandidate,
    confidence: row.confidence / 100,
    clarifyingQuestion: row.clarifyingQuestion,
    rationale: row.rationale,
    labelIds: [],
    subtasks: row.subtasks ?? [],
    editedFields: (row.editedFields ?? []) as TaskEditableField[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function rowToMemory(row: typeof schema.memories.$inferSelect): Memory {
  return {
    id: row.id,
    text: row.text,
    kind: row.kind,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
  };
}
