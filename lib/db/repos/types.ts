import type {
  Decision,
  DecisionAnswer,
  DecisionKind,
  DecisionPayload,
  DecisionStatus,
  Label,
  LabelTone,
  Memory,
  Subtask,
  Task,
  TaskEditableField,
  Tier,
  UserProfile,
} from "@/lib/domain/types";

/**
 * Repository interface.
 *
 * The DB-backed implementation lives in `pg.ts` and uses Drizzle. The
 * in-memory implementation lives in `memory.ts` and is what tests use.
 * Routes consume `getRepos()` and don't care which is which.
 *
 * Every method that mutates or reads tenant data takes `userId` as the
 * first argument. The DB implementation must include `userId` in the SQL
 * predicate; a regression test in `tests/db/tenancy.test.ts` enforces this.
 */

/**
 * Accounts are normally created by Better Auth (`lib/auth/auth.ts`); this
 * input exists for the auth-bypass bootstrap, the in-memory mirror, and
 * tests. Credentials never pass through here.
 */
export interface UserCreateInput {
  /** Optional caller-fixed id (used by the auth-bypass bootstrap). */
  id?: string;
  email: string;
  displayName: string;
  isCreator: boolean;
}

/**
 * Persisted billing facts for one user.
 *
 * `tier` is the tier that was effective when the row was last written. Trial
 * and comp expiry are time-based, so readers never trust it directly: they
 * call `deriveEntitlement()` which re-resolves the tier from the facts
 * (`trialEndsAt`, `subscriptionActive`, `compedAt`/`compedUntil`, the
 * creator flag on the profile) using the precedence
 * `creator > comped > pro > trialing > free`. Writers set `tier` with
 * `resolveTier()` so the stored value is a usable cache for reporting.
 */
export interface EntitlementSnapshot {
  tier: Tier;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Stripe says there is a paying subscription (active or in Stripe's own trial). */
  subscriptionActive: boolean;
  /** Set when an invite code granted Pro; null when never comped. */
  compedAt: string | null;
  /** Comp end; null means forever (when `compedAt` is set). */
  compedUntil: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  currentPeriodEnd: string | null;
  /**
   * Pro is kept until this moment after a failed payment (`subscriptionActive`
   * is already false). Null when no grace period is running.
   */
  graceEndsAt: string | null;
  /**
   * `created` of the newest Stripe event applied to the tracked subscription;
   * older events for that subscription are ignored (out-of-order delivery).
   */
  stripeSyncedAt: string | null;
}

export interface TaskCreateInput {
  /**
   * Optional client-generated id. The client store creates tasks
   * optimistically and pushes them; accepting its id keeps sync free of
   * id-remapping. Ids are unguessable random strings, so collisions across
   * tenants are a rejected edge case, not a routine path.
   */
  id?: string;
  sourceText: string;
  sourceContext: string | null;
  /** Preserved when replaying offline-captured tasks. */
  createdAt?: string;
}

export interface MemoryCreateInput {
  id?: string;
  text: string;
  kind?: Memory["kind"];
  pinned?: boolean;
  createdAt?: string;
}

export interface LabelEnsureInput {
  /** Id to use if the label doesn't exist yet. */
  id: string;
  name: string;
  tone: LabelTone;
}

/** `ai_runs.stage` for the accounting row that represents one accepted sift. */
export const SIFT_ACCOUNTING_STAGE = "sift";

export interface AiRunWriteInput {
  userId: string;
  taskId: string | null;
  promptVersion: string;
  /**
   * Pipeline stage (`lib/ai/models.ts` `Stage`), `SIFT_ACCOUNTING_STAGE` for
   * the row that represents one accepted sift, or null for legacy rows and
   * pre-resolution failures.
   */
  stage?: string | null;
  /** Groups the accounting row and the per-stage rows of one sift. */
  siftId?: string | null;
  workflowRunId?: string | null;
  /** Canonical `provider/model` slug of the model that answered. */
  model: string;
  /** "gateway" | "direct" | "offline" | "unknown". */
  transport: string;
  status: "succeeded" | "failed";
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Fractional cents from registry list prices; null when usage was not reported. */
  costCents: number | null;
  offline: boolean;
  error: string | null;
}

export interface UserRepo {
  create(input: UserCreateInput): Promise<UserProfile>;
  getById(id: string): Promise<UserProfile | null>;
  getByEmail(email: string): Promise<UserProfile | null>;
  /**
   * Grant or withdraw the creator flag. Only `lib/auth` calls this, and only
   * once the address has been verified; see `promoteVerifiedCreator`.
   */
  setCreator(userId: string, isCreator: boolean): Promise<void>;
  setStripeCustomerId(userId: string, customerId: string): Promise<void>;
  findByStripeCustomerId(customerId: string): Promise<UserProfile | null>;
  /** Every account in `id` order, `limit` at a time, starting after `afterId`. */
  list(limit: number, afterId?: string): Promise<UserProfile[]>;
  /**
   * Remove the user and everything they own (tasks, labels, memories,
   * events, AI runs, sessions, entitlement). Returns false when no such
   * user exists.
   */
  delete(userId: string): Promise<boolean>;
}

export interface EntitlementRepo {
  get(userId: string): Promise<EntitlementSnapshot | null>;
  /** Idempotent upsert. Overwrites every fact; use `update` when other writers may race. */
  upsert(userId: string, snapshot: EntitlementSnapshot): Promise<EntitlementSnapshot>;
  /**
   * Atomic read-modify-write: the row is locked while `mutate` runs, so two
   * writers (Stripe webhook, invite redemption, checkout) serialize and the
   * second one sees the first one's facts instead of clobbering them.
   */
  update(
    userId: string,
    mutate: (current: EntitlementSnapshot | null) => EntitlementSnapshot,
  ): Promise<EntitlementSnapshot>;
  startTrialIfMissing(userId: string, days: number): Promise<EntitlementSnapshot>;
  /** Users whose dunning grace period ended at or before `now`, oldest first. */
  listExpiredGracePeriods(now: Date, limit: number): Promise<string[]>;
}

/** Thrown when a client-supplied entity id already belongs to another tenant. */
export class IdConflictError extends Error {
  constructor(id: string) {
    super(`Id is not available: ${id}`);
    this.name = "IdConflictError";
  }
}

export interface LabelRepo {
  /** Oldest first. `limit` undefined returns every label (label picker, export). */
  list(userId: string, opts?: { limit?: number }): Promise<Label[]>;
  /** Only the labels in `ids` that belong to the user; bounded by `ids.length`. */
  listByIds(userId: string, ids: readonly string[]): Promise<Label[]>;
  /** Case-insensitive name lookup; bounded by `names.length`. */
  findByNames(userId: string, names: readonly string[]): Promise<Label[]>;
  /**
   * Idempotent ensure-by-name (case-insensitive). Returns the existing
   * label when the name is already taken, and mints a fresh id when the
   * suggested one is unavailable — the caller must treat the returned
   * label (not its input) as canonical.
   */
  ensure(userId: string, input: LabelEnsureInput): Promise<Label>;
}

export interface TaskListOptions {
  /** Keep only these lifecycles. */
  lifecycles?: readonly Task["lifecycle"][];
  /** Only tasks with a due date on or before this `YYYY-MM-DD` day. */
  dueOnOrBefore?: string;
  /** Default `updatedAt` (newest first). `due` is soonest first, undated excluded. */
  orderBy?: "updatedAt" | "due";
  /** Undefined returns every matching task. */
  limit?: number;
}

export interface TaskRepo {
  list(userId: string, opts?: TaskListOptions): Promise<Task[]>;
  get(userId: string, taskId: string): Promise<Task | null>;
  create(userId: string, input: TaskCreateInput): Promise<Task>;
  /**
   * Narrow update. With `ifSiftId` the write is conditional on the row's
   * current `siftId` (null included) and returns null when it differs, so a
   * sift step or a sift claim cannot overwrite a run that superseded it.
   */
  update(
    userId: string,
    taskId: string,
    patch: Partial<Task>,
    opts?: { editedFields?: TaskEditableField[]; ifSiftId?: string | null },
  ): Promise<Task | null>;
  delete(userId: string, taskId: string): Promise<boolean>;
  addSubtask(userId: string, taskId: string, subtask: Subtask): Promise<Task | null>;
  toggleSubtask(userId: string, taskId: string, subtaskId: string): Promise<Task | null>;
  removeSubtask(userId: string, taskId: string, subtaskId: string): Promise<Task | null>;
}

export interface MemoryRepo {
  /** Newest first. `limit` undefined returns every memory. */
  list(userId: string, opts?: { pinned?: boolean; limit?: number }): Promise<Memory[]>;
  create(userId: string, input: MemoryCreateInput): Promise<Memory>;
  update(userId: string, id: string, patch: Partial<Memory>): Promise<Memory | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface DecisionCreateInput {
  /** Caller-fixed id when the hook token must be known before the row exists. */
  id?: string;
  kind: DecisionKind;
  taskId: string | null;
  payload: DecisionPayload;
  resumeToken: string | null;
  expiresAt: string | null;
}

export type DecisionResolution = Exclude<DecisionStatus, "open">;

export interface DecisionRepo {
  create(userId: string, input: DecisionCreateInput): Promise<Decision>;
  get(userId: string, id: string): Promise<Decision | null>;
  /**
   * Open decisions still inside their deadline, newest first. What the
   * inbox and the badge show; a row past `expiresAt` is hidden even if
   * the run that would close it is gone. Every read is bounded.
   */
  listOpen(userId: string, opts: { limit: number }): Promise<Decision[]>;
  /** Same filter as `listOpen`. */
  countOpen(userId: string): Promise<number>;
  /**
   * Every `open` decision attached to one task, newest first, at most
   * `limit` — deadline included, so a re-sift or a delete can close a row
   * whose run already died.
   */
  listOpenForTask(userId: string, taskId: string, opts: { limit: number }): Promise<Decision[]>;
  /**
   * Compare-and-set out of `open`: returns the resolved row, or null when
   * the decision does not exist for this user or was already resolved, so
   * two answers (two tabs, a link and the app) can never both win.
   */
  resolve(
    userId: string,
    id: string,
    input: { status: DecisionResolution; answer: DecisionAnswer | null },
  ): Promise<Decision | null>;
}

export interface AiRunRecord {
  id: string;
  taskId: string | null;
  stage: string | null;
  promptVersion: string;
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
}

export type AiRunRollupKey = "day" | "stage" | "model" | "user";

/** One row of the admin cost view: every tenant's runs grouped by `key`. */
export interface AiRunRollupRow {
  /** ISO day, stage name, model slug, or user id depending on the grouping. */
  key: string;
  runs: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface AiRunRepo {
  insert(input: AiRunWriteInput): Promise<{ id: string; createdAt: string }>;
  /**
   * Flip a run's status (the sift accounting row is written as `succeeded`
   * when the sift is accepted and marked `failed` if the workflow dies).
   */
  setStatus(
    userId: string,
    id: string,
    status: "succeeded" | "failed",
    error?: string | null,
  ): Promise<void>;
  /**
   * Fill in a reserved row once the model has answered: the daily plan
   * writes its billing row before `start()` (so the cap sees it at once)
   * and completes it here, keeping one row per run even across a retry.
   */
  complete(
    userId: string,
    id: string,
    patch: Pick<
      AiRunWriteInput,
      "model" | "transport" | "status" | "durationMs" | "inputTokens" | "outputTokens" | "costCents"
    > &
      Partial<Pick<AiRunWriteInput, "promptVersion" | "workflowRunId" | "error" | "offline">>,
  ): Promise<void>;
  /**
   * Sifts that count against today's cap: succeeded, online, and a billing
   * unit (`siftId` null, or the `sift` accounting row). Per-stage detail rows
   * of a workflow sift are excluded so a five-stage sift is one sift.
   */
  countSucceededToday(userId: string, now?: Date): Promise<number>;
  /**
   * Billing units (same rule as above, any status) recorded at or after
   * `since`. Backs the cross-instance sliding-window rate limit on AI routes.
   */
  countSince(userId: string, since: Date): Promise<number>;
  /** Newest first. `limit` undefined returns every run (data export). */
  list(userId: string, limit?: number): Promise<AiRunRecord[]>;
  /**
   * Cross-tenant aggregate for the creator-only cost view. The only read in
   * the repository layer without a `userId` predicate; callers must gate on
   * `session.user.isCreator`.
   */
  rollup(input: { since: Date; by: AiRunRollupKey }): Promise<AiRunRollupRow[]>;
}

/**
 * Audit trail entries. The daily plan writes one per task it moved, with a
 * human-readable `reason` in the payload.
 */
export type TaskEventKind =
  | "plan.moved_in"
  | "plan.moved_out"
  | "plan.rescored"
  /** A memory extraction ran for this task's sift after a contradicting edit. */
  | "memory.extracted";

export interface TaskEventRecord {
  id: string;
  taskId: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TaskEventAppendInput {
  /**
   * Caller-fixed id makes the append idempotent: a retried workflow step
   * that re-writes the same event leaves one row.
   */
  id?: string;
  taskId: string;
  kind: TaskEventKind;
  payload: Record<string, unknown>;
}

export interface TaskEventRepo {
  /** Oldest first. `limit` undefined returns every event. */
  list(userId: string, limit?: number): Promise<TaskEventRecord[]>;
  /** Newest first, one task. */
  listForTask(userId: string, taskId: string, limit: number): Promise<TaskEventRecord[]>;
  /** Idempotent on `id`: an existing row is returned untouched. */
  append(userId: string, input: TaskEventAppendInput): Promise<TaskEventRecord>;
}

export type DailyPlanTrigger = "cron" | "manual";
export type DailyPlanStatus = "running" | "completed" | "failed";
export type DailyPlanMoveKind = "moved_in" | "moved_out" | "rescored";

export interface DailyPlanMove {
  taskId: string;
  title: string;
  kind: DailyPlanMoveKind;
  /** Short explanation shown to the user ("due tomorrow, high importance"). */
  reason: string;
}

export interface DailyPlanRecord {
  id: string;
  userId: string;
  /** Local `YYYY-MM-DD` the plan is for. */
  planDate: string;
  timezone: string;
  trigger: DailyPlanTrigger;
  status: DailyPlanStatus;
  workflowRunId: string | null;
  aiRunId: string | null;
  summary: string | null;
  moves: DailyPlanMove[];
  considered: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * A `running` plan older than this is treated as dead (the workflow was
 * lost between claim and finish) and no longer blocks a manual re-plan.
 */
export const DAILY_PLAN_LEASE_MS = 10 * 60 * 1000;

export type DailyPlanClaim =
  | { ok: true; plan: DailyPlanRecord }
  /** A `running` plan inside its lease already exists for the user. */
  | { ok: false; reason: "running"; plan: DailyPlanRecord }
  /** Cron only: this (user, planDate) already has a cron plan. */
  | { ok: false; reason: "planned" };

export interface DailyPlanRepo {
  /**
   * Reserve a run, atomically with respect to other claims for the same
   * user: at most one `running` plan inside its lease per user (two
   * overlapping "Re-plan today" clicks start one workflow), and for `cron`
   * one plan per (user, planDate) so a cron rerun enqueues nothing.
   */
  claim(
    input: {
      userId: string;
      planDate: string;
      timezone: string;
      trigger: DailyPlanTrigger;
      /** The pre-reserved `prioritize` `ai_runs` row this run bills against. */
      aiRunId: string;
    },
    now?: Date,
  ): Promise<DailyPlanClaim>;
  get(userId: string, id: string): Promise<DailyPlanRecord | null>;
  /** The newest plan for the user, any status. */
  latest(userId: string): Promise<DailyPlanRecord | null>;
  /** A `running` plan inside its lease, or null. */
  runningFor(userId: string, now?: Date): Promise<DailyPlanRecord | null>;
  update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<
        DailyPlanRecord,
        "status" | "workflowRunId" | "aiRunId" | "summary" | "moves" | "considered" | "error"
      >
    > & { finishedAt?: string | null },
  ): Promise<DailyPlanRecord | null>;
}

export interface StripeEventRepo {
  /** Returns true if this is the first time we've seen this event id. */
  recordIfNew(eventId: string, type: string): Promise<boolean>;
  /** Remove a recorded event id so Stripe retries can re-process. */
  delete(eventId: string): Promise<void>;
}

export type InviteGrant = "pro";

export interface InviteCode {
  id: string;
  codeHash: string;
  grants: InviteGrant;
  durationMonths: number | null;
  maxRedemptions: number;
  redemptionCount: number;
  expiresAt: string | null;
  note: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InviteCodeCreateInput {
  codeHash: string;
  grants: InviteGrant;
  durationMonths: number | null;
  maxRedemptions: number;
  expiresAt: string | null;
  note: string | null;
}

export interface InviteRedemption {
  id: string;
  codeId: string;
  userId: string;
  compedUntil: string | null;
  redeemedAt: string;
}

/** Why `consume` refused; the order here is the order checks run in. */
export type InviteConsumeFailure = "revoked" | "expired" | "exhausted" | "already_redeemed";

/** The comp a redemption grants, derived from the user's locked entitlement. */
export interface CompGrant {
  compedAt: string;
  compedUntil: string | null;
  tier: Tier;
}

export interface InviteCodeRepo {
  create(input: InviteCodeCreateInput): Promise<InviteCode>;
  findByHash(codeHash: string): Promise<InviteCode | null>;
  getById(id: string): Promise<InviteCode | null>;
  list(): Promise<InviteCode[]>;
  revoke(id: string, at?: Date): Promise<InviteCode | null>;
  /**
   * One atomic unit: lock the user's entitlement, let the caller derive the
   * grant from it, record the redemption, bump the code's count (refusing
   * when revoked / expired / exhausted), and write only the comp columns of
   * the entitlement. Either everything commits or nothing does, so a spent
   * code always comes with its Pro grant, concurrent Stripe writes to the
   * same row are never clobbered, two users racing for the last redemption
   * cannot both succeed, and the same user redeeming twice gets
   * `already_redeemed` rather than a constraint error.
   */
  consume(
    codeId: string,
    userId: string,
    input: { grant: (current: EntitlementSnapshot | null) => CompGrant; now?: Date },
  ): Promise<
    | { ok: true; redemption: InviteRedemption; entitlement: EntitlementSnapshot }
    | { ok: false; reason: InviteConsumeFailure }
  >;
  listRedemptions(codeId: string): Promise<InviteRedemption[]>;
  listRedemptionsForUser(userId: string): Promise<InviteRedemption[]>;
}

export type DigestKind = "morning_plan" | "due_reminder" | "weekly_review";
export type NotificationChannel = "email" | "push";

/** Everything the user can set; hours are local to `timezone`. */
export interface NotificationPreferencesInput {
  timezone: string;
  emailEnabled: boolean;
  pushEnabled: boolean;
  morningPlanEnabled: boolean;
  morningPlanHour: number;
  dueRemindersEnabled: boolean;
  dueReminderHour: number;
  weeklyReviewEnabled: boolean;
  weeklyReviewDay: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export interface NotificationPreferencesRecord extends NotificationPreferencesInput {
  userId: string;
  updatedAt: string;
}

export interface NotificationPreferencesRepo {
  get(userId: string): Promise<NotificationPreferencesRecord | null>;
  upsert(
    userId: string,
    input: NotificationPreferencesInput,
  ): Promise<NotificationPreferencesRecord>;
  /**
   * Saved preference rows in `userId` order, `limit` at a time, starting
   * after `afterUserId`. Only users who saved preferences are candidates for
   * digests: the defaults alone never trigger a send, because without a
   * saved timezone the morning plan would land at the wrong hour.
   */
  list(limit: number, afterUserId?: string): Promise<NotificationPreferencesRecord[]>;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface PushSubscriptionRecord extends PushSubscriptionInput {
  id: string;
  userId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Devices per account; keeps the digest fan-out and the Settings list bounded. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

export interface PushSubscriptionRepo {
  /** Oldest first, capped at `MAX_PUSH_SUBSCRIPTIONS_PER_USER`. */
  listForUser(userId: string): Promise<PushSubscriptionRecord[]>;
  /**
   * Idempotent on `endpoint`: the same browser re-subscribing updates keys
   * in place, and an endpoint previously registered by another account on
   * this browser moves to the caller.
   */
  upsert(userId: string, input: PushSubscriptionInput): Promise<PushSubscriptionRecord>;
  deleteByEndpoint(userId: string, endpoint: string): Promise<boolean>;
  /** Drop a subscription the push service reported gone (404/410), whoever owns it. */
  remove(id: string): Promise<void>;
  touch(id: string, at: Date): Promise<void>;
}

export type NotificationSendStatus = "pending" | "sent" | "skipped" | "failed";

export interface NotificationSendRecord {
  id: string;
  userId: string;
  kind: DigestKind;
  channel: NotificationChannel;
  periodKey: string;
  status: NotificationSendStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/**
 * How long a `pending` claim is honoured. A runner killed between claim
 * and finalize (function timeout, crash) would otherwise block that period
 * forever; after the lease the next run takes the claim over.
 */
export const NOTIFICATION_CLAIM_LEASE_MS = 10 * 60 * 1000;

export interface NotificationSendRepo {
  /**
   * Reserve (user, kind, channel, period) before sending. Returns null when
   * a row already exists — finalized in any status, or still `pending`
   * within its lease — so a rerun or a concurrent run leaves the first
   * claimant as the only sender. A `pending` row older than the lease is
   * taken over (same id, fresh `createdAt`).
   */
  claim(
    input: {
      userId: string;
      kind: DigestKind;
      channel: NotificationChannel;
      periodKey: string;
    },
    now?: Date,
  ): Promise<{ id: string } | null>;
  finalize(
    id: string,
    outcome: { status: Exclude<NotificationSendStatus, "pending">; error?: string | null },
  ): Promise<void>;
  /** Newest first. */
  listForUser(userId: string, limit?: number): Promise<NotificationSendRecord[]>;
}

export interface Repos {
  users: UserRepo;
  entitlements: EntitlementRepo;
  tasks: TaskRepo;
  labels: LabelRepo;
  memories: MemoryRepo;
  decisions: DecisionRepo;
  aiRuns: AiRunRepo;
  taskEvents: TaskEventRepo;
  stripeEvents: StripeEventRepo;
  inviteCodes: InviteCodeRepo;
  notificationPreferences: NotificationPreferencesRepo;
  pushSubscriptions: PushSubscriptionRepo;
  notificationSends: NotificationSendRepo;
  dailyPlans: DailyPlanRepo;
}
