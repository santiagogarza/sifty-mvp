import {
  boolean,
  date,
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

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
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
  tier: text("tier", { enum: ["creator", "trialing", "active", "expired"] }).notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** Stripe subscription id, set when subscribed. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** "active" | "trialing" | "past_due" | "canceled" | etc. raw from Stripe. */
  stripeStatus: text("stripe_status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  aiRunsLimitDay: integer("ai_runs_limit_day").notNull().default(0),
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
    confidence: integer("confidence_x100").notNull().default(0),
    clarifyingQuestion: text("clarifying_question"),
    rationale: text("rationale"),
    /** Markdown handoff brief from "Prepare for agent". */
    agentBrief: text("agent_brief"),
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
    model: text("model").notNull(),
    transport: text("transport").notNull(),
    status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costCents: integer("cost_cents"),
    offline: boolean("offline").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_user_created_idx").on(t.userId, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
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

export type DbUser = typeof users.$inferSelect;
export type DbEntitlement = typeof entitlements.$inferSelect;
export type DbTask = typeof tasks.$inferSelect;
export type DbLabel = typeof labels.$inferSelect;
export type DbMemory = typeof memories.$inferSelect;
export type DbAiRun = typeof aiRuns.$inferSelect;
export type DbSession = typeof sessions.$inferSelect;
