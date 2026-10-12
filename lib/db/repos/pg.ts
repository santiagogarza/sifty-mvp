import { LABEL_TONES, type Label, type LabelTone } from "@/lib/domain/types";
import type { Memory, Subtask, Task, TaskEditableField } from "@/lib/domain/types";
import { emptySnapshot, trialSnapshot } from "@/lib/entitlements/entitlements";
import { id as makeId } from "@/lib/utils/ids";
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import * as schema from "../schema";
import { taskPatchColumns } from "./task-columns";
import {
  type AiRunRepo,
  type AiRunWriteInput,
  type EntitlementRepo,
  type EntitlementSnapshot,
  IdConflictError,
  type InviteCode,
  type InviteCodeRepo,
  type InviteConsumeFailure,
  type InviteRedemption,
  type LabelRepo,
  type MemoryCreateInput,
  type MemoryRepo,
  type Repos,
  type SessionRepo,
  type StripeEventRepo,
  type TaskCreateInput,
  type TaskRepo,
  type UserCreateInput,
  type UserRepo,
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
      const id = input.id ?? makeId("user");
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
        subscriptionActive: ent.subscriptionActive,
        compedAt: ent.compedAt?.toISOString() ?? null,
        compedUntil: ent.compedUntil?.toISOString() ?? null,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: ent.stripeSubscriptionId,
        stripeStatus: ent.stripeStatus,
        currentPeriodEnd: ent.currentPeriodEnd?.toISOString() ?? null,
      };
    },
    async upsert(userId, snapshot) {
      const db = getDb();
      const columns = {
        tier: snapshot.tier,
        trialEndsAt: toDate(snapshot.trialEndsAt),
        subscriptionActive: snapshot.subscriptionActive,
        compedAt: toDate(snapshot.compedAt),
        compedUntil: toDate(snapshot.compedUntil),
        stripeSubscriptionId: snapshot.stripeSubscriptionId,
        stripeStatus: snapshot.stripeStatus,
        currentPeriodEnd: toDate(snapshot.currentPeriodEnd),
        updatedAt: new Date(),
      };
      await db
        .insert(schema.entitlements)
        .values({ userId, ...columns })
        .onConflictDoUpdate({ target: schema.entitlements.userId, set: columns });
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
      return entitlements.upsert(userId, trialSnapshot(days));
    },
  };

  const labels: LabelRepo = {
    async list(userId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.labels)
        .where(eq(schema.labels.userId, userId))
        .orderBy(schema.labels.createdAt);
      return rows.map(rowToLabel);
    },
    async ensure(userId, input) {
      const db = getDb();
      const findByName = () =>
        db
          .select()
          .from(schema.labels)
          .where(
            and(
              eq(schema.labels.userId, userId),
              sql`lower(${schema.labels.name}) = lower(${input.name})`,
            ),
          );
      const [existing] = await findByName();
      if (existing) return rowToLabel(existing);

      const tryInsert = (id: string) =>
        db
          .insert(schema.labels)
          .values({ id, userId, name: input.name, tone: input.tone })
          .onConflictDoNothing()
          .returning();

      const inserted = await tryInsert(input.id);
      if (inserted.length) return rowToLabel(inserted[0]!);

      // Insert lost a conflict: either a concurrent create of the same
      // name won (adopt it), or the suggested id is taken — possibly by
      // another tenant — so mint a fresh id instead of failing.
      const [raced] = await findByName();
      if (raced) return rowToLabel(raced);
      const reminted = await tryInsert(makeId("label"));
      if (reminted.length) return rowToLabel(reminted[0]!);
      const [row] = await findByName();
      return rowToLabel(row!);
    },
  };

  const tasks: TaskRepo = {
    async list(userId) {
      const db = getDb();
      const [rows, labelRows] = await Promise.all([
        db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.userId, userId))
          .orderBy(desc(schema.tasks.updatedAt)),
        db.select().from(schema.taskLabels).where(eq(schema.taskLabels.userId, userId)),
      ]);
      const byTask = groupLabelIds(labelRows);
      return rows.map((row) => rowToTask(row, byTask.get(row.id) ?? []));
    },
    async get(userId, taskId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
      if (!row) return null;
      const labelRows = await db
        .select()
        .from(schema.taskLabels)
        .where(and(eq(schema.taskLabels.taskId, taskId), eq(schema.taskLabels.userId, userId)));
      return rowToTask(
        row,
        labelRows.map((l) => l.labelId),
      );
    },
    async create(userId, input: TaskCreateInput) {
      const db = getDb();
      const text = input.sourceText.trim();
      const provisionalTitle = text.length > 80 ? `${text.slice(0, 78)}…` : text || "Untitled task";
      const id = input.id ?? makeId("task");
      const now = new Date();
      const createdAt = input.createdAt ? new Date(input.createdAt) : now;
      const inserted = await db
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
          createdAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return rowToTask(inserted[0]!, []);
      // Conflict on the client-supplied id: idempotent replay for the
      // owner, hard reject for anyone else.
      const existing = await tasks.get(userId, id);
      if (existing) return existing;
      throw new IdConflictError(id);
    },
    async update(userId, taskId, patch, opts) {
      const db = getDb();
      const existing = await tasks.get(userId, taskId);
      if (!existing) return null;

      // Narrow SET: only the provided keys (and what they derive) are
      // written, so concurrent edits to other fields are never overwritten
      // with this caller's stale read.
      const columns = taskPatchColumns(existing, patch, {
        editedFields: opts?.editedFields,
        now: new Date(),
      });

      // Task row + label links change together — one transaction.
      await db.transaction(async (tx) => {
        await tx
          .update(schema.tasks)
          .set(columns)
          .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));

        if (patch.labelIds) {
          // Only link labels this user owns; a stale/foreign id is dropped.
          const owned = patch.labelIds.length
            ? await tx
                .select({ id: schema.labels.id })
                .from(schema.labels)
                .where(
                  and(eq(schema.labels.userId, userId), inArray(schema.labels.id, patch.labelIds)),
                )
            : [];
          await tx
            .delete(schema.taskLabels)
            .where(and(eq(schema.taskLabels.taskId, taskId), eq(schema.taskLabels.userId, userId)));
          if (owned.length) {
            await tx
              .insert(schema.taskLabels)
              .values(owned.map((l) => ({ taskId, labelId: l.id, userId })))
              .onConflictDoNothing();
          }
        }
      });

      return tasks.get(userId, taskId);
    },
    async delete(userId, taskId) {
      const db = getDb();
      const deleted = await db
        .delete(schema.tasks)
        .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)))
        .returning({ id: schema.tasks.id });
      return deleted.length > 0;
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
    async create(userId, input: MemoryCreateInput) {
      const db = getDb();
      const id = input.id ?? makeId("mem");
      const inserted = await db
        .insert(schema.memories)
        .values({
          id,
          userId,
          text: input.text,
          kind: input.kind ?? "preference",
          pinned: input.pinned ?? false,
          createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return rowToMemory(inserted[0]!);
      // Conflict on the id: idempotent replay for the owner, hard reject
      // for anyone else.
      const [existing] = await db.select().from(schema.memories).where(eq(schema.memories.id, id));
      if (existing && existing.userId === userId) return rowToMemory(existing);
      throw new IdConflictError(id);
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
      const deleted = await db
        .delete(schema.memories)
        .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId)))
        .returning({ id: schema.memories.id });
      return deleted.length > 0;
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
        stage: input.stage ?? null,
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
    async countSince(userId, since) {
      const db = getDb();
      const [row] = await db
        .select({ value: count() })
        .from(schema.aiRuns)
        .where(and(eq(schema.aiRuns.userId, userId), gte(schema.aiRuns.createdAt, since)));
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
        stage: r.stage,
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
      const inserted = await db
        .insert(schema.stripeEvents)
        .values({ id: eventId, type })
        .onConflictDoNothing()
        .returning({ id: schema.stripeEvents.id });
      return inserted.length > 0;
    },
    async delete(eventId) {
      const db = getDb();
      await db.delete(schema.stripeEvents).where(eq(schema.stripeEvents.id, eventId));
    },
  };

  const inviteCodes: InviteCodeRepo = {
    async create(input) {
      const db = getDb();
      const [row] = await db
        .insert(schema.inviteCodes)
        .values({
          id: makeId("inv"),
          codeHash: input.codeHash,
          grants: input.grants,
          durationMonths: input.durationMonths,
          maxRedemptions: input.maxRedemptions,
          expiresAt: toDate(input.expiresAt),
          note: input.note,
        })
        .returning();
      return rowToInviteCode(row!);
    },
    async findByHash(codeHash) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.inviteCodes)
        .where(eq(schema.inviteCodes.codeHash, codeHash));
      return row ? rowToInviteCode(row) : null;
    },
    async getById(id) {
      const db = getDb();
      const [row] = await db.select().from(schema.inviteCodes).where(eq(schema.inviteCodes.id, id));
      return row ? rowToInviteCode(row) : null;
    },
    async list() {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.inviteCodes)
        .orderBy(desc(schema.inviteCodes.createdAt));
      return rows.map(rowToInviteCode);
    },
    async revoke(id, at = new Date()) {
      const db = getDb();
      await db
        .update(schema.inviteCodes)
        .set({ revokedAt: at })
        .where(and(eq(schema.inviteCodes.id, id), isNull(schema.inviteCodes.revokedAt)));
      return inviteCodes.getById(id);
    },
    async consume(codeId, userId, input) {
      const db = getDb();
      const now = input.now ?? new Date();
      class Refused extends Error {
        constructor(readonly reason: InviteConsumeFailure) {
          super(reason);
        }
      }
      try {
        return await db.transaction(async (tx) => {
          // Lock the entitlement row first so the grant is derived from the
          // committed state and a concurrent Stripe webhook serializes
          // behind us instead of being overwritten.
          const [entRow] = await tx
            .select()
            .from(schema.entitlements)
            .where(eq(schema.entitlements.userId, userId))
            .for("update");
          const [userRow] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
          const current: EntitlementSnapshot | null = entRow
            ? {
                tier: entRow.tier,
                trialStartedAt: userRow?.trialStartedAt?.toISOString() ?? null,
                trialEndsAt: entRow.trialEndsAt?.toISOString() ?? null,
                subscriptionActive: entRow.subscriptionActive,
                compedAt: entRow.compedAt?.toISOString() ?? null,
                compedUntil: entRow.compedUntil?.toISOString() ?? null,
                stripeCustomerId: userRow?.stripeCustomerId ?? null,
                stripeSubscriptionId: entRow.stripeSubscriptionId,
                stripeStatus: entRow.stripeStatus,
                currentPeriodEnd: entRow.currentPeriodEnd?.toISOString() ?? null,
              }
            : null;
          const grant = input.grant(current);

          // The unique (code_id, user_id) index is the once-per-user guard;
          // a concurrent duplicate waits on it and then sees no row.
          const inserted = await tx
            .insert(schema.inviteRedemptions)
            .values({
              id: makeId("red"),
              codeId,
              userId,
              compedUntil: toDate(grant.compedUntil),
              redeemedAt: now,
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted.length) throw new Refused("already_redeemed");

          // One conditional UPDATE is the atomic check-and-increment: two
          // racing redeemers serialize on the row lock and only the first
          // sees `redemption_count < max_redemptions`.
          const bumped = await tx
            .update(schema.inviteCodes)
            .set({ redemptionCount: sql`${schema.inviteCodes.redemptionCount} + 1` })
            .where(
              and(
                eq(schema.inviteCodes.id, codeId),
                isNull(schema.inviteCodes.revokedAt),
                or(isNull(schema.inviteCodes.expiresAt), gt(schema.inviteCodes.expiresAt, now)),
                lt(schema.inviteCodes.redemptionCount, schema.inviteCodes.maxRedemptions),
              ),
            )
            .returning({ id: schema.inviteCodes.id });
          if (!bumped.length) {
            const [code] = await tx
              .select()
              .from(schema.inviteCodes)
              .where(eq(schema.inviteCodes.id, codeId));
            if (!code) throw new Refused("expired");
            if (code.revokedAt) throw new Refused("revoked");
            if (code.expiresAt && code.expiresAt.getTime() <= now.getTime()) {
              throw new Refused("expired");
            }
            throw new Refused("exhausted");
          }

          // Only the comp columns move; Stripe facts on the row stay as the
          // webhook left them.
          const compColumns = {
            tier: grant.tier,
            compedAt: toDate(grant.compedAt),
            compedUntil: toDate(grant.compedUntil),
            updatedAt: now,
          };
          if (entRow) {
            await tx
              .update(schema.entitlements)
              .set(compColumns)
              .where(eq(schema.entitlements.userId, userId));
          } else {
            await tx.insert(schema.entitlements).values({ userId, ...compColumns });
          }
          const entitlement: EntitlementSnapshot = {
            ...(current ?? emptySnapshot()),
            tier: grant.tier,
            compedAt: grant.compedAt,
            compedUntil: grant.compedUntil,
          };
          return { ok: true as const, redemption: rowToRedemption(inserted[0]!), entitlement };
        });
      } catch (err) {
        if (err instanceof Refused) return { ok: false as const, reason: err.reason };
        throw err;
      }
    },
    async listRedemptions(codeId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.inviteRedemptions)
        .where(eq(schema.inviteRedemptions.codeId, codeId))
        .orderBy(desc(schema.inviteRedemptions.redeemedAt));
      return rows.map(rowToRedemption);
    },
    async listRedemptionsForUser(userId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.inviteRedemptions)
        .where(eq(schema.inviteRedemptions.userId, userId))
        .orderBy(desc(schema.inviteRedemptions.redeemedAt));
      return rows.map(rowToRedemption);
    },
  };

  return {
    users,
    entitlements,
    tasks,
    labels,
    memories,
    aiRuns,
    sessions,
    stripeEvents,
    inviteCodes,
  };
}

function rowToInviteCode(row: typeof schema.inviteCodes.$inferSelect): InviteCode {
  return {
    id: row.id,
    codeHash: row.codeHash,
    grants: row.grants,
    durationMonths: row.durationMonths,
    maxRedemptions: row.maxRedemptions,
    redemptionCount: row.redemptionCount,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    note: row.note,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToRedemption(row: typeof schema.inviteRedemptions.$inferSelect): InviteRedemption {
  return {
    id: row.id,
    codeId: row.codeId,
    userId: row.userId,
    compedUntil: row.compedUntil?.toISOString() ?? null,
    redeemedAt: row.redeemedAt.toISOString(),
  };
}

function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function groupLabelIds(rows: Array<{ taskId: string; labelId: string }>): Map<string, string[]> {
  const byTask = new Map<string, string[]>();
  for (const row of rows) {
    const list = byTask.get(row.taskId);
    if (list) list.push(row.labelId);
    else byTask.set(row.taskId, [row.labelId]);
  }
  return byTask;
}

function rowToLabel(row: typeof schema.labels.$inferSelect): Label {
  const tone = (LABEL_TONES as readonly string[]).includes(row.tone)
    ? (row.tone as LabelTone)
    : "neutral";
  return { id: row.id, name: row.name, tone };
}

function rowToTask(row: typeof schema.tasks.$inferSelect, labelIds: string[]): Task {
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
    assigneeName: row.assigneeName,
    confidence: row.confidence / 100,
    clarifyingQuestion: row.clarifyingQuestion,
    rationale: row.rationale,
    agentBrief: row.agentBrief,
    labelIds,
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
