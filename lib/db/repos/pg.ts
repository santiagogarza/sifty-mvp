import { LABEL_TONES, type Label, type LabelTone } from "@/lib/domain/types";
import type {
  Decision,
  DecisionAnswer,
  DecisionPayload,
  Memory,
  Subtask,
  Task,
  TaskEditableField,
} from "@/lib/domain/types";
import { emptySnapshot, trialSnapshot } from "@/lib/entitlements/entitlements";
import { id as makeId } from "@/lib/utils/ids";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../client";
import * as schema from "../schema";
import { taskPatchColumns } from "./task-columns";
import {
  type AiRunRepo,
  type AiRunWriteInput,
  DAILY_PLAN_LEASE_MS,
  type DailyPlanRecord,
  type DailyPlanRepo,
  type DecisionCreateInput,
  type DecisionRepo,
  type EntitlementRepo,
  type EntitlementSnapshot,
  IdConflictError,
  type InviteCode,
  type InviteCodeRepo,
  type InviteConsumeFailure,
  type InviteRedemption,
  type LabelRepo,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type MemoryCreateInput,
  type MemoryRepo,
  NOTIFICATION_CLAIM_LEASE_MS,
  type NotificationChannel,
  type NotificationPreferencesRecord,
  type NotificationPreferencesRepo,
  type NotificationSendRecord,
  type NotificationSendRepo,
  type PushSubscriptionRecord,
  type PushSubscriptionRepo,
  type Repos,
  SERIES_LIST_LIMIT,
  SIFT_ACCOUNTING_STAGE,
  type StripeEventRepo,
  type TaskCreateInput,
  type TaskEventRepo,
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
      };
    },
    async setCreator(userId, isCreator) {
      const db = getDb();
      await db
        .update(schema.users)
        .set({ isCreator, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    },
    async setStripeCustomerId(userId, customerId) {
      const db = getDb();
      await db
        .update(schema.users)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    },
    async list(limit, afterId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.users)
        .where(afterId === undefined ? undefined : gt(schema.users.id, afterId))
        .orderBy(asc(schema.users.id))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        isCreator: row.isCreator,
        createdAt: row.createdAt.toISOString(),
      }));
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
    async delete(userId) {
      const db = getDb();
      // Every tenant table references users with ON DELETE CASCADE.
      const deleted = await db
        .delete(schema.users)
        .where(eq(schema.users.id, userId))
        .returning({ id: schema.users.id });
      return deleted.length > 0;
    },
  };

  // One executor type covers both the pool and a transaction handle.
  type Executor = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;

  async function readEntitlement(
    ex: Executor,
    userId: string,
    opts: { lock?: boolean } = {},
  ): Promise<EntitlementSnapshot | null> {
    const q = ex.select().from(schema.entitlements).where(eq(schema.entitlements.userId, userId));
    const [ent] = opts.lock ? await q.for("update") : await q;
    const [user] = await ex.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!ent || !user) return null;
    return entitlementRowToSnapshot(ent, user);
  }

  async function writeEntitlement(
    ex: Executor,
    userId: string,
    snapshot: EntitlementSnapshot,
  ): Promise<void> {
    const columns = entitlementColumns(snapshot, new Date());
    await ex
      .insert(schema.entitlements)
      .values({ userId, ...columns })
      .onConflictDoUpdate({ target: schema.entitlements.userId, set: columns });
    if (snapshot.trialStartedAt || snapshot.stripeCustomerId) {
      await ex
        .update(schema.users)
        .set({
          trialStartedAt: snapshot.trialStartedAt ? new Date(snapshot.trialStartedAt) : undefined,
          stripeCustomerId: snapshot.stripeCustomerId ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));
    }
  }

  const entitlements: EntitlementRepo = {
    async get(userId) {
      return readEntitlement(getDb(), userId);
    },
    async upsert(userId, snapshot) {
      await writeEntitlement(getDb(), userId, snapshot);
      return { ...snapshot };
    },
    async update(userId, mutate) {
      const db = getDb();
      return db.transaction(async (tx) => {
        const current = await readEntitlement(tx, userId, { lock: true });
        const next = mutate(current);
        await writeEntitlement(tx, userId, next);
        return { ...next };
      });
    },
    async startTrialIfMissing(userId, days) {
      const existing = await entitlements.get(userId);
      if (existing) return existing;
      return entitlements.upsert(userId, trialSnapshot(days));
    },
    async listExpiredGracePeriods(now, limit) {
      const db = getDb();
      const rows = await db
        .select({ userId: schema.entitlements.userId })
        .from(schema.entitlements)
        .where(lte(schema.entitlements.graceEndsAt, now))
        .orderBy(schema.entitlements.graceEndsAt)
        .limit(limit);
      return rows.map((r) => r.userId);
    },
  };

  const labels: LabelRepo = {
    async list(userId, opts = {}) {
      const db = getDb();
      const query = db
        .select()
        .from(schema.labels)
        .where(eq(schema.labels.userId, userId))
        .orderBy(schema.labels.createdAt);
      const rows = opts.limit === undefined ? await query : await query.limit(opts.limit);
      return rows.map(rowToLabel);
    },
    async findByNames(userId, names) {
      if (!names.length) return [];
      const db = getDb();
      const lowered = Array.from(new Set(names.map((n) => n.toLowerCase())));
      const rows = await db
        .select()
        .from(schema.labels)
        .where(
          and(
            eq(schema.labels.userId, userId),
            inArray(sql`lower(${schema.labels.name})`, lowered),
          ),
        )
        .orderBy(schema.labels.createdAt)
        .limit(lowered.length);
      return rows.map(rowToLabel);
    },
    async listByIds(userId, ids) {
      if (!ids.length) return [];
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.labels)
        .where(and(eq(schema.labels.userId, userId), inArray(schema.labels.id, [...ids])))
        .orderBy(schema.labels.createdAt)
        .limit(ids.length);
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
    async list(userId, opts = {}) {
      const db = getDb();
      const byDue = opts.orderBy === "due";
      const filtered = !!opts.lifecycles || opts.dueOnOrBefore !== undefined || byDue;
      const rowsQuery = db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.userId, userId),
            opts.lifecycles ? inArray(schema.tasks.lifecycle, [...opts.lifecycles]) : undefined,
            opts.dueOnOrBefore !== undefined
              ? lte(schema.tasks.due, opts.dueOnOrBefore)
              : byDue
                ? isNotNull(schema.tasks.due)
                : undefined,
          ),
        )
        .orderBy(
          ...(byDue
            ? [asc(schema.tasks.due), desc(schema.tasks.updatedAt)]
            : [desc(schema.tasks.updatedAt)]),
        );
      const rows = opts.limit === undefined ? await rowsQuery : await rowsQuery.limit(opts.limit);
      if (!rows.length) return [];
      // Unbounded list: one query for every link. Bounded: only the links
      // of the rows returned, so a LIMIT stays a LIMIT.
      const labelRows = await db
        .select()
        .from(schema.taskLabels)
        .where(
          and(
            eq(schema.taskLabels.userId, userId),
            opts.limit === undefined && !filtered
              ? undefined
              : inArray(
                  schema.taskLabels.taskId,
                  rows.map((r) => r.id),
                ),
          ),
        );
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
    async listBySeries(userId, seriesId, opts = {}) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.userId, userId),
            eq(schema.tasks.seriesId, seriesId),
            opts.lifecycles ? inArray(schema.tasks.lifecycle, [...opts.lifecycles]) : undefined,
          ),
        )
        .orderBy(desc(schema.tasks.createdAt))
        .limit(opts.limit ?? SERIES_LIST_LIMIT);
      if (!rows.length) return [];
      const labelRows = await db
        .select()
        .from(schema.taskLabels)
        .where(
          and(
            eq(schema.taskLabels.userId, userId),
            inArray(
              schema.taskLabels.taskId,
              rows.map((r) => r.id),
            ),
          ),
        );
      const byTask = groupLabelIds(labelRows);
      return rows.map((row) => rowToTask(row, byTask.get(row.id) ?? []));
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

      // The sift guard is part of the UPDATE's own predicate, so the
      // check and the write are one statement.
      const siftGuard =
        opts && "ifSiftId" in opts
          ? opts.ifSiftId === null || opts.ifSiftId === undefined
            ? isNull(schema.tasks.siftId)
            : eq(schema.tasks.siftId, opts.ifSiftId)
          : undefined;

      // Task row + label links change together — one transaction.
      const written = await db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.tasks)
          .set(columns)
          .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId), siftGuard))
          .returning({ id: schema.tasks.id });
        if (updated.length === 0) return false;

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
        return true;
      });
      if (!written) return null;

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
    async list(userId, opts = {}) {
      const db = getDb();
      const query = db
        .select()
        .from(schema.memories)
        .where(
          and(
            eq(schema.memories.userId, userId),
            opts.pinned === undefined ? undefined : eq(schema.memories.pinned, opts.pinned),
          ),
        )
        .orderBy(desc(schema.memories.createdAt));
      const rows = opts.limit === undefined ? await query : await query.limit(opts.limit);
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

  // Open and not past its deadline; see `isLive` in the memory repo.
  const liveDecision = (now: Date) =>
    and(
      eq(schema.decisions.status, "open"),
      or(isNull(schema.decisions.expiresAt), gt(schema.decisions.expiresAt, now)),
    );

  const decisions: DecisionRepo = {
    async create(userId, input: DecisionCreateInput) {
      const db = getDb();
      const id = input.id ?? makeId("dec");
      const now = new Date();
      const inserted = await db
        .insert(schema.decisions)
        .values({
          id,
          userId,
          kind: input.kind,
          status: "open",
          taskId: input.taskId,
          payload: input.payload as unknown as Record<string, unknown>,
          answer: null,
          resumeToken: input.resumeToken,
          expiresAt: toDate(input.expiresAt),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return rowToDecision(inserted[0]!);
      // Conflict on a caller-fixed id: idempotent for the owner (a retried
      // workflow step), rejected for anyone else.
      const existing = await decisions.get(userId, id);
      if (existing) return existing;
      throw new IdConflictError(id);
    },
    async get(userId, id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.decisions)
        .where(and(eq(schema.decisions.id, id), eq(schema.decisions.userId, userId)));
      return row ? rowToDecision(row) : null;
    },
    async listOpen(userId, opts) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.decisions)
        .where(and(eq(schema.decisions.userId, userId), liveDecision(new Date())))
        .orderBy(desc(schema.decisions.createdAt), desc(schema.decisions.id))
        .limit(opts.limit);
      return rows.map(rowToDecision);
    },
    async countOpen(userId) {
      const db = getDb();
      const [row] = await db
        .select({ value: count() })
        .from(schema.decisions)
        .where(and(eq(schema.decisions.userId, userId), liveDecision(new Date())));
      return row?.value ?? 0;
    },
    async listOpenForTask(userId, taskId, opts) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.decisions)
        .where(
          and(
            eq(schema.decisions.userId, userId),
            eq(schema.decisions.taskId, taskId),
            eq(schema.decisions.status, "open"),
          ),
        )
        .orderBy(desc(schema.decisions.createdAt))
        .limit(opts.limit);
      return rows.map(rowToDecision);
    },
    async listByKind(userId, kind, opts) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.decisions)
        .where(and(eq(schema.decisions.userId, userId), eq(schema.decisions.kind, kind)))
        .orderBy(desc(schema.decisions.createdAt), desc(schema.decisions.id))
        .limit(opts.limit);
      return rows.map(rowToDecision);
    },
    async resolve(userId, id, input) {
      const db = getDb();
      const now = new Date();
      // `status = 'open'` in the predicate makes the check and the write one
      // statement: the second of two concurrent answers updates zero rows.
      const [row] = await db
        .update(schema.decisions)
        .set({
          status: input.status,
          answer: (input.answer as unknown as Record<string, unknown>) ?? null,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.decisions.id, id),
            eq(schema.decisions.userId, userId),
            eq(schema.decisions.status, "open"),
          ),
        )
        .returning();
      return row ? rowToDecision(row) : null;
    },
  };

  // See `AiRunRepo.countSucceededToday`: legacy single-shot rows and the
  // `sift` accounting row count; per-stage rows of a workflow sift do not.
  const billingUnit = or(
    isNull(schema.aiRuns.siftId),
    eq(schema.aiRuns.stage, SIFT_ACCOUNTING_STAGE),
  );

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
        siftId: input.siftId ?? null,
        workflowRunId: input.workflowRunId ?? null,
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
    async setStatus(userId, id, status, error) {
      const db = getDb();
      await db
        .update(schema.aiRuns)
        .set({ status, ...(error !== undefined ? { error } : {}) })
        .where(and(eq(schema.aiRuns.id, id), eq(schema.aiRuns.userId, userId)));
    },
    async complete(userId, id, patch) {
      const db = getDb();
      await db
        .update(schema.aiRuns)
        .set({
          model: patch.model,
          transport: patch.transport,
          status: patch.status,
          durationMs: patch.durationMs,
          inputTokens: patch.inputTokens,
          outputTokens: patch.outputTokens,
          costCents: patch.costCents,
          ...(patch.promptVersion !== undefined ? { promptVersion: patch.promptVersion } : {}),
          ...(patch.workflowRunId !== undefined ? { workflowRunId: patch.workflowRunId } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.offline !== undefined ? { offline: patch.offline } : {}),
        })
        .where(and(eq(schema.aiRuns.id, id), eq(schema.aiRuns.userId, userId)));
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
            billingUnit,
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
        .where(
          and(eq(schema.aiRuns.userId, userId), billingUnit, gte(schema.aiRuns.createdAt, since)),
        );
      return row?.value ?? 0;
    },
    async rollup({ since, by }) {
      const db = getDb();
      const key =
        by === "day"
          ? sql<string>`to_char(${schema.aiRuns.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
          : by === "stage"
            ? sql<string>`coalesce(${schema.aiRuns.stage}, 'legacy')`
            : by === "model"
              ? sql<string>`${schema.aiRuns.model}`
              : sql<string>`${schema.aiRuns.userId}`;
      const rows = await db
        .select({
          key,
          runs: count(),
          failed: sql<number>`count(*) filter (where ${schema.aiRuns.status} = 'failed')`,
          inputTokens: sql<number>`coalesce(sum(${schema.aiRuns.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${schema.aiRuns.outputTokens}), 0)`,
          costCents: sql<number>`coalesce(sum(${schema.aiRuns.costCents}), 0)`,
        })
        .from(schema.aiRuns)
        .where(gte(schema.aiRuns.createdAt, since))
        .groupBy(key);
      // postgres-js returns bigint sums and counts as strings.
      const normalized = rows.map((r) => ({
        key: r.key,
        runs: Number(r.runs),
        failed: Number(r.failed),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        costCents: Number(r.costCents),
      }));
      return normalized.sort((a, b) =>
        by === "day" ? b.key.localeCompare(a.key) : b.costCents - a.costCents || b.runs - a.runs,
      );
    },
    async list(userId, limit) {
      const db = getDb();
      const query = db
        .select()
        .from(schema.aiRuns)
        .where(eq(schema.aiRuns.userId, userId))
        .orderBy(desc(schema.aiRuns.createdAt));
      const rows = limit === undefined ? await query : await query.limit(limit);
      return rows.map((r) => ({
        id: r.id,
        taskId: r.taskId,
        stage: r.stage,
        promptVersion: r.promptVersion,
        siftId: r.siftId,
        workflowRunId: r.workflowRunId,
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

  const taskEvents: TaskEventRepo = {
    async list(userId, limit) {
      const db = getDb();
      const query = db
        .select()
        .from(schema.taskEvents)
        .where(eq(schema.taskEvents.userId, userId))
        .orderBy(schema.taskEvents.createdAt);
      const rows = limit === undefined ? await query : await query.limit(limit);
      return rows.map(rowToTaskEvent);
    },
    async listForTask(userId, taskId, limit) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.taskEvents)
        .where(and(eq(schema.taskEvents.userId, userId), eq(schema.taskEvents.taskId, taskId)))
        .orderBy(desc(schema.taskEvents.createdAt))
        .limit(limit);
      return rows.map(rowToTaskEvent);
    },
    async append(userId, input) {
      const db = getDb();
      const id = input.id ?? makeId("evt");
      const inserted = await db
        .insert(schema.taskEvents)
        .values({ id, userId, taskId: input.taskId, kind: input.kind, payload: input.payload })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) return rowToTaskEvent(inserted[0]!);
      const [existing] = await db
        .select()
        .from(schema.taskEvents)
        .where(eq(schema.taskEvents.id, id));
      if (existing && existing.userId === userId) return rowToTaskEvent(existing);
      throw new IdConflictError(id);
    },
  };

  const dailyPlans: DailyPlanRepo = {
    async claim(input, now = new Date()) {
      const db = getDb();
      const since = new Date(now.getTime() - DAILY_PLAN_LEASE_MS);
      return db.transaction(async (tx) => {
        // Serialize claims per user so two overlapping "Re-plan today"
        // requests cannot both pass the running check. Transaction-scoped:
        // released on commit or rollback.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`daily_plan:${input.userId}`}))`,
        );
        const [running] = await tx
          .select()
          .from(schema.dailyPlans)
          .where(
            and(
              eq(schema.dailyPlans.userId, input.userId),
              eq(schema.dailyPlans.status, "running"),
              gt(schema.dailyPlans.createdAt, since),
            ),
          )
          .orderBy(desc(schema.dailyPlans.createdAt))
          .limit(1);
        if (running) return { ok: false, reason: "running", plan: rowToDailyPlan(running) };
        // The partial unique index (user, plan_date) WHERE trigger = 'cron'
        // is the per-day claim: a losing insert returns no row.
        const inserted = await tx
          .insert(schema.dailyPlans)
          .values({
            id: makeId("plan"),
            userId: input.userId,
            planDate: input.planDate,
            timezone: input.timezone,
            trigger: input.trigger,
            status: "running",
            aiRunId: input.aiRunId,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length) return { ok: false, reason: "planned" };
        return { ok: true, plan: rowToDailyPlan(inserted[0]!) };
      });
    },
    async get(userId, id) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.dailyPlans)
        .where(and(eq(schema.dailyPlans.id, id), eq(schema.dailyPlans.userId, userId)));
      return row ? rowToDailyPlan(row) : null;
    },
    async latest(userId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.dailyPlans)
        .where(eq(schema.dailyPlans.userId, userId))
        .orderBy(desc(schema.dailyPlans.createdAt))
        .limit(1);
      return row ? rowToDailyPlan(row) : null;
    },
    async runningFor(userId, now = new Date()) {
      const db = getDb();
      const since = new Date(now.getTime() - DAILY_PLAN_LEASE_MS);
      const [row] = await db
        .select()
        .from(schema.dailyPlans)
        .where(
          and(
            eq(schema.dailyPlans.userId, userId),
            eq(schema.dailyPlans.status, "running"),
            gt(schema.dailyPlans.createdAt, since),
          ),
        )
        .orderBy(desc(schema.dailyPlans.createdAt))
        .limit(1);
      return row ? rowToDailyPlan(row) : null;
    },
    async update(userId, id, patch) {
      const db = getDb();
      const { finishedAt, ...rest } = patch;
      const [row] = await db
        .update(schema.dailyPlans)
        .set({
          ...rest,
          ...(finishedAt !== undefined ? { finishedAt: toDate(finishedAt) } : {}),
        })
        .where(and(eq(schema.dailyPlans.id, id), eq(schema.dailyPlans.userId, userId)))
        .returning();
      return row ? rowToDailyPlan(row) : null;
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
          const current = await readEntitlement(tx, userId, { lock: true });
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
          if (current) {
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

  const notificationPreferences: NotificationPreferencesRepo = {
    async get(userId) {
      const db = getDb();
      const [row] = await db
        .select()
        .from(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.userId, userId));
      return row ? rowToPreferences(row) : null;
    },
    async upsert(userId, input) {
      const db = getDb();
      const columns = { ...input, updatedAt: new Date() };
      const [row] = await db
        .insert(schema.notificationPreferences)
        .values({ userId, ...columns })
        .onConflictDoUpdate({ target: schema.notificationPreferences.userId, set: columns })
        .returning();
      return rowToPreferences(row!);
    },
    async list(limit, afterUserId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.notificationPreferences)
        .where(afterUserId ? gt(schema.notificationPreferences.userId, afterUserId) : undefined)
        .orderBy(schema.notificationPreferences.userId)
        .limit(limit);
      return rows.map(rowToPreferences);
    },
  };

  const pushSubscriptions: PushSubscriptionRepo = {
    async listForUser(userId) {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.userId, userId))
        .orderBy(schema.pushSubscriptions.createdAt)
        .limit(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
      return rows.map(rowToPushSubscription);
    },
    async upsert(userId, input) {
      const db = getDb();
      const [row] = await db
        .insert(schema.pushSubscriptions)
        .values({ id: makeId("push"), userId, ...input })
        .onConflictDoUpdate({
          target: schema.pushSubscriptions.endpoint,
          set: {
            userId,
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            // A browser that changed accounts starts a fresh delivery history.
            lastUsedAt: sql`CASE WHEN ${schema.pushSubscriptions.userId} = ${userId} THEN ${schema.pushSubscriptions.lastUsedAt} ELSE NULL END`,
          },
        })
        .returning();
      return rowToPushSubscription(row!);
    },
    async deleteByEndpoint(userId, endpoint) {
      const db = getDb();
      const deleted = await db
        .delete(schema.pushSubscriptions)
        .where(
          and(
            eq(schema.pushSubscriptions.userId, userId),
            eq(schema.pushSubscriptions.endpoint, endpoint),
          ),
        )
        .returning({ id: schema.pushSubscriptions.id });
      return deleted.length > 0;
    },
    async remove(id) {
      const db = getDb();
      await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, id));
    },
    async touch(id, at) {
      const db = getDb();
      await db
        .update(schema.pushSubscriptions)
        .set({ lastUsedAt: at })
        .where(eq(schema.pushSubscriptions.id, id));
    },
  };

  const notificationSends: NotificationSendRepo = {
    async claim(input, now = new Date()) {
      const db = getDb();
      // The unique (user, kind, channel, period) index is the lock: a
      // concurrent claimant waits on it and then updates nothing, unless
      // the existing row is a `pending` claim whose lease ran out.
      const leaseEdge = new Date(now.getTime() - NOTIFICATION_CLAIM_LEASE_MS);
      const rows = await db
        .insert(schema.notificationSends)
        .values({ id: makeId("send"), ...input, status: "pending", createdAt: now })
        .onConflictDoUpdate({
          target: [
            schema.notificationSends.userId,
            schema.notificationSends.kind,
            schema.notificationSends.channel,
            schema.notificationSends.periodKey,
          ],
          set: { createdAt: now, error: null },
          setWhere: and(
            eq(schema.notificationSends.status, "pending"),
            lt(schema.notificationSends.createdAt, leaseEdge),
          ),
        })
        .returning({ id: schema.notificationSends.id });
      return rows[0] ?? null;
    },
    async finalize(id, outcome) {
      const db = getDb();
      await db
        .update(schema.notificationSends)
        .set({
          status: outcome.status,
          error: outcome.error ?? null,
          sentAt: outcome.status === "sent" ? new Date() : null,
        })
        .where(eq(schema.notificationSends.id, id));
    },
    async listForUser(userId, limit) {
      const db = getDb();
      const query = db
        .select()
        .from(schema.notificationSends)
        .where(eq(schema.notificationSends.userId, userId))
        .orderBy(desc(schema.notificationSends.createdAt));
      const rows = limit === undefined ? await query : await query.limit(limit);
      return rows.map(rowToNotificationSend);
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
  };
}

function rowToPreferences(
  row: typeof schema.notificationPreferences.$inferSelect,
): NotificationPreferencesRecord {
  return {
    userId: row.userId,
    timezone: row.timezone,
    emailEnabled: row.emailEnabled,
    pushEnabled: row.pushEnabled,
    morningPlanEnabled: row.morningPlanEnabled,
    morningPlanHour: row.morningPlanHour,
    dueRemindersEnabled: row.dueRemindersEnabled,
    dueReminderHour: row.dueReminderHour,
    weeklyReviewEnabled: row.weeklyReviewEnabled,
    weeklyReviewDay: row.weeklyReviewDay,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToPushSubscription(
  row: typeof schema.pushSubscriptions.$inferSelect,
): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function rowToNotificationSend(
  row: typeof schema.notificationSends.$inferSelect,
): NotificationSendRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as NotificationSendRecord["kind"],
    channel: row.channel as NotificationChannel,
    periodKey: row.periodKey,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

function rowToTaskEvent(row: typeof schema.taskEvents.$inferSelect) {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    payload: row.payload ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToDailyPlan(row: typeof schema.dailyPlans.$inferSelect): DailyPlanRecord {
  return {
    id: row.id,
    userId: row.userId,
    planDate: row.planDate,
    timezone: row.timezone,
    trigger: row.trigger,
    status: row.status,
    workflowRunId: row.workflowRunId,
    aiRunId: row.aiRunId,
    summary: row.summary,
    moves: row.moves ?? [],
    considered: row.considered,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function rowToDecision(row: typeof schema.decisions.$inferSelect): Decision {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    taskId: row.taskId,
    payload: row.payload as unknown as DecisionPayload,
    answer: (row.answer as unknown as DecisionAnswer | null) ?? null,
    resumeToken: row.resumeToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
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

function entitlementRowToSnapshot(
  ent: typeof schema.entitlements.$inferSelect,
  user: typeof schema.users.$inferSelect,
): EntitlementSnapshot {
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
    graceEndsAt: ent.graceEndsAt?.toISOString() ?? null,
    stripeSyncedAt: ent.stripeSyncedAt?.toISOString() ?? null,
  };
}

function entitlementColumns(snapshot: EntitlementSnapshot, now: Date) {
  return {
    tier: snapshot.tier,
    trialEndsAt: toDate(snapshot.trialEndsAt),
    subscriptionActive: snapshot.subscriptionActive,
    compedAt: toDate(snapshot.compedAt),
    compedUntil: toDate(snapshot.compedUntil),
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    stripeStatus: snapshot.stripeStatus,
    currentPeriodEnd: toDate(snapshot.currentPeriodEnd),
    graceEndsAt: toDate(snapshot.graceEndsAt),
    stripeSyncedAt: toDate(snapshot.stripeSyncedAt),
    updatedAt: now,
  };
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
    siftId: row.siftId,
    siftStage: row.siftStage,
    plan: row.plan ?? null,
    recurrence: (row.recurrence as Task["recurrence"]) ?? null,
    seriesId: row.seriesId,
    siftedWithAssumptions: row.siftedWithAssumptions,
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
