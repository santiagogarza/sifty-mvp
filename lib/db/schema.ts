import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Sifty database schema.
 *
 * Conventions:
 * - All ids are application-generated (`nanoid`) and stored as `text`. We
 *   never expose sequential integers; they leak volume.
 * - All tenant-scoped tables include `userId` and an index on it. The
 *   tenancy guard in `lib/db/repos` always includes `userId` in the
 *   predicate and tests assert this never regresses.
 * - Timestamps use `timestamp with timezone`. We store ISO strings in app
 *   types but the DB owns ordering.
 * - Soft-typed `jsonb` columns are reserved for fields where the shape is
 *   well-defined in the domain model and indexing isn't needed (subtasks,
 *   editedFields).
 */

/**
 * `users`, `sessions`, `accounts`, and `verifications` are also Better
 * Auth's models (mapped in `lib/auth/auth.ts`: `name` → `displayName`,
 * table names pluralised). Password hashes live in `accounts.password`
 * (provider `credential`), never on the user row.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    displayName: text("display_name").notNull(),
    isCreator: boolean("is_creator").notNull().default(false),
    /** Trial start; null until first non-creator login. */
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    /** Stripe customer id, set on first checkout. */
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(t.email)],
);

export const entitlements = pgTable("entitlements", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Effective tier when the row was last written. Readers re-derive it
   * (`deriveEntitlement`) because trial and comp expiry are time-based.
   */
  tier: text("tier", { enum: ["free", "trialing", "pro", "comped", "creator"] }).notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** Mirror of Stripe: a paying subscription exists. */
  subscriptionActive: boolean("subscription_active").notNull().default(false),
  /** Invite-code comp: when it was granted, and when it ends (null = forever). */
  compedAt: timestamp("comped_at", { withTimezone: true }),
  compedUntil: timestamp("comped_until", { withTimezone: true }),
  /** Stripe subscription id, set when subscribed. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** "active" | "trialing" | "past_due" | "canceled" | etc. raw from Stripe. */
  stripeStatus: text("stripe_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /**
   * Dunning grace: Pro stays on until this moment after a failed payment.
   * Set by the first failure, cleared by recovery, cancellation, or
   * `expireGracePeriods()`.
   */
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  /**
   * `created` of the newest Stripe event applied to the tracked
   * subscription. Stripe does not guarantee delivery order, so older events
   * for the same subscription are ignored instead of rewinding state.
   */
  stripeSyncedAt: timestamp("stripe_synced_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceText: text("source_text").notNull(),
    sourceContext: text("source_context"),
    title: text("title").notNull(),
    description: text("description"),
    nextAction: text("next_action"),
    lifecycle: text("lifecycle", {
      enum: ["inbox", "active", "waiting", "someday", "done", "dropped"],
    })
      .notNull()
      .default("inbox"),
    aiStatus: text("ai_status", { enum: ["idle", "pending", "running", "ready", "failed"] })
      .notNull()
      .default("pending"),
    aiError: text("ai_error"),
    aiAttempts: integer("ai_attempts").notNull().default(0),
    urgency: integer("urgency_x100").notNull().default(40),
    importance: integer("importance_x100").notNull().default(40),
    priorityBucket: text("priority_bucket", {
      enum: ["do_now", "schedule", "delegate", "drop", "unset"],
    })
      .notNull()
      .default("unset"),
    effort: text("effort", { enum: ["quick", "small", "medium", "deep"] })
      .notNull()
      .default("small"),
    due: date("due"),
    delegationCandidate: text("delegation_candidate", {
      enum: ["self", "ai", "person", "unsure"],
    })
      .notNull()
      .default("unsure"),
    assigneeName: text("assignee_name"),
    confidence: integer("confidence_x100").notNull().default(0),
    clarifyingQuestion: text("clarifying_question"),
    rationale: text("rationale"),
    /** Markdown handoff brief from "Prepare for agent". */
    agentBrief: text("agent_brief"),
    /**
     * The sift (workflow run) that currently owns this task's AI fields.
     * Steps compare it before writing, so a re-sift supersedes an older run
     * that is still in flight instead of racing it.
     */
    siftId: text("sift_id"),
    /** Stage in progress (or the one that failed); null when idle/ready. */
    siftStage: text("sift_stage", {
      enum: ["enrich", "prioritize", "triage", "subtasks", "plan"],
    }),
    /** Output of the `plan` stage: can AI do it, which executor, which connectors. */
    plan: jsonb("plan").$type<{
      executor: "self" | "ai_agent" | "cursor_agent" | "person" | "none";
      approach: string | null;
      connectors: string[];
      readyForAi: boolean;
      blockers: string | null;
      promptVersion: string;
    }>(),
    /** Field names the user has manually edited; protected from re-triage. */
    editedFields: jsonb("edited_fields").$type<string[]>().notNull().default([]),
    /** Inline subtasks (small list, no need for a join). */
    subtasks: jsonb("subtasks")
      .$type<Array<{ id: string; title: string; done: boolean; order: number }>>()
      .notNull()
      .default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_user_lifecycle_idx").on(t.userId, t.lifecycle),
    index("tasks_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

export const labels = pgTable(
  "labels",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tone: text("tone").notNull().default("neutral"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("labels_user_name_idx").on(t.userId, t.name)],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: text("kind", { enum: ["preference", "fact", "context"] })
      .notNull()
      .default("preference"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memories_user_pinned_idx").on(t.userId, t.pinned)],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    /** "created" | "updated" | "ai_triage" | "deleted" | "lifecycle" */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_events_user_task_idx").on(t.userId, t.taskId)],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    promptVersion: text("prompt_version").notNull(),
    /**
     * Pipeline stage (`lib/ai/models.ts`), or `"sift"` for the accounting
     * row written when a sift is accepted. Null on rows written before 0003.
     */
    stage: text("stage"),
    /**
     * Groups the rows of one sift: the `sift` accounting row plus one row per
     * stage step. Null for single-shot runs (legacy triage, agent briefs).
     * Caps count rows where `sift_id IS NULL OR stage = 'sift'`, never the
     * per-stage detail, so a five-stage sift is one sift.
     */
    siftId: text("sift_id"),
    /** Workflow run id (`wrun_…`) for the dashboard; null outside Workflow. */
    workflowRunId: text("workflow_run_id"),
    /** Canonical `provider/model` slug of the model that answered. */
    model: text("model").notNull(),
    /** "gateway" | "direct" | "offline" | "unknown". */
    transport: text("transport").notNull(),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Fractional: a Haiku triage costs well under one cent, so integer cents
    // rounded every run to zero and made spend reporting useless.
    costCents: doublePrecision("cost_cents"),
    offline: boolean("offline").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_runs_user_created_idx").on(t.userId, t.createdAt),
    index("ai_runs_sift_idx").on(t.siftId),
    // The admin cost view groups every tenant's rows by day.
    index("ai_runs_created_idx").on(t.createdAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Opaque bearer stored (signed) in the session cookie. */
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_token_idx").on(t.token)],
);

/** Credential (password) and OAuth links per user. One row per provider. */
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Provider-side id: the user id for `credential`, the Google sub for `google`. */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** scrypt hash for new passwords; legacy `$2*` bcrypt hashes are still verified. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_idx").on(t.providerId, t.accountId),
  ],
);

/** Short-lived tokens: email verification, password reset, magic links, OAuth state. */
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/**
 * Stripe webhook deduplication.
 *
 * Stripe may deliver the same event multiple times. We persist event ids
 * on first successful processing; subsequent receipts return early.
 */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Invite codes grant `comped` (Pro without Stripe). Only the SHA-256 of
 * `INVITE_CODE_PEPPER` + code is stored; the plaintext is shown once when
 * minted. Revocation is a timestamp so the audit trail keeps the row.
 */
export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    grants: text("grants", { enum: ["pro"] })
      .notNull()
      .default("pro"),
    /** Months of comp per redemption; null = forever. */
    durationMonths: integer("duration_months"),
    maxRedemptions: integer("max_redemptions").notNull().default(1),
    redemptionCount: integer("redemption_count").notNull().default(0),
    /** Last moment the code can be redeemed; null = no deadline. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    note: text("note"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invite_codes_hash_idx").on(t.codeHash)],
);

export const inviteRedemptions = pgTable(
  "invite_redemptions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id")
      .notNull()
      .references(() => inviteCodes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Comp end granted by this redemption; null = forever. */
    compedUntil: timestamp("comped_until", { withTimezone: true }),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invite_redemptions_code_user_idx").on(t.codeId, t.userId),
    index("invite_redemptions_user_idx").on(t.userId),
  ],
);

/**
 * Per-user notification settings. One row per user, created on first save;
 * readers treat a missing row as the defaults (`lib/notifications/preferences`).
 * Hours are local to `timezone` (IANA name) and whole hours, because Vercel
 * Cron runs hourly at best.
 */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  pushEnabled: boolean("push_enabled").notNull().default(false),
  morningPlanEnabled: boolean("morning_plan_enabled").notNull().default(true),
  /** Local hour (0–23) the morning plan and the weekly review go out. */
  morningPlanHour: integer("morning_plan_hour").notNull().default(7),
  dueRemindersEnabled: boolean("due_reminders_enabled").notNull().default(true),
  /** Local hour (0–23) of the afternoon due/overdue nudge. */
  dueReminderHour: integer("due_reminder_hour").notNull().default(15),
  weeklyReviewEnabled: boolean("weekly_review_enabled").notNull().default(true),
  /** 0 = Sunday … 6 = Saturday. */
  weeklyReviewDay: integer("weekly_review_day").notNull().default(0),
  /** Quiet hours [start, end) in local hours; both null = none. May wrap midnight. */
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Web Push subscriptions (one per browser/device). The endpoint is unique
 * across users: re-subscribing from the same browser after switching
 * accounts moves the row rather than fanning out to two people.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

/**
 * Digest send ledger. One row per (user, digest kind, channel, period) is
 * claimed before anything goes out, so a cron rerun — or two overlapping
 * runs — can never deliver the same digest twice.
 */
export const notificationSends = pgTable(
  "notification_sends",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "morning_plan" | "due_reminder" | "weekly_review" */
    kind: text("kind").notNull(),
    /** "email" | "push" */
    channel: text("channel").notNull(),
    /** Local date `YYYY-MM-DD` for daily digests, `YYYY-Www` for weekly. */
    periodKey: text("period_key").notNull(),
    status: text("status", { enum: ["pending", "sent", "skipped", "failed"] })
      .notNull()
      .default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notification_sends_period_idx").on(t.userId, t.kind, t.channel, t.periodKey),
  ],
);

export type DbUser = typeof users.$inferSelect;
export type DbEntitlement = typeof entitlements.$inferSelect;
export type DbTask = typeof tasks.$inferSelect;
export type DbLabel = typeof labels.$inferSelect;
export type DbMemory = typeof memories.$inferSelect;
export type DbAiRun = typeof aiRuns.$inferSelect;
export type DbSession = typeof sessions.$inferSelect;
export type DbAccount = typeof accounts.$inferSelect;
