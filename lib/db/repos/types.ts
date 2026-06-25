import type { Memory, Subtask, Task, TaskEditableField, UserProfile } from "@/lib/domain/types";

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

export interface UserCreateInput {
  email: string;
  passwordHash: string | null;
  displayName: string;
  isCreator: boolean;
}

export interface EntitlementSnapshot {
  tier: "creator" | "trialing" | "active" | "expired";
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscriptionActive: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  currentPeriodEnd: string | null;
  aiRunsLimitDay: number;
}

export interface TaskCreateInput {
  sourceText: string;
  sourceContext: string | null;
}

export interface AiRunWriteInput {
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
}

export interface UserRepo {
  create(input: UserCreateInput): Promise<UserProfile>;
  getById(id: string): Promise<UserProfile | null>;
  getByEmail(email: string): Promise<(UserProfile & { passwordHash: string | null }) | null>;
  setStripeCustomerId(userId: string, customerId: string): Promise<void>;
  findByStripeCustomerId(customerId: string): Promise<UserProfile | null>;
}

export interface EntitlementRepo {
  get(userId: string): Promise<EntitlementSnapshot | null>;
  /** Idempotent upsert. */
  upsert(userId: string, snapshot: EntitlementSnapshot): Promise<EntitlementSnapshot>;
  startTrialIfMissing(userId: string, days: number): Promise<EntitlementSnapshot>;
}

export interface TaskRepo {
  list(userId: string): Promise<Task[]>;
  get(userId: string, taskId: string): Promise<Task | null>;
  create(userId: string, input: TaskCreateInput): Promise<Task>;
  update(
    userId: string,
    taskId: string,
    patch: Partial<Task>,
    opts?: { editedFields?: TaskEditableField[] },
  ): Promise<Task | null>;
  delete(userId: string, taskId: string): Promise<boolean>;
  addSubtask(userId: string, taskId: string, subtask: Subtask): Promise<Task | null>;
  toggleSubtask(userId: string, taskId: string, subtaskId: string): Promise<Task | null>;
  removeSubtask(userId: string, taskId: string, subtaskId: string): Promise<Task | null>;
}

export interface MemoryRepo {
  list(userId: string): Promise<Memory[]>;
  create(userId: string, text: string): Promise<Memory>;
  update(userId: string, id: string, patch: Partial<Memory>): Promise<Memory | null>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface AiRunRepo {
  insert(input: AiRunWriteInput): Promise<{ id: string; createdAt: string }>;
  countSucceededToday(userId: string, now?: Date): Promise<number>;
  list(
    userId: string,
    limit?: number,
  ): Promise<
    Array<{
      id: string;
      taskId: string | null;
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
    }>
  >;
}

export interface SessionRepo {
  create(userId: string, ttlMs: number): Promise<{ id: string; expiresAt: string }>;
  get(id: string): Promise<{ userId: string; expiresAt: string } | null>;
  delete(id: string): Promise<void>;
}

export interface StripeEventRepo {
  /** Returns true if this is the first time we've seen this event id. */
  recordIfNew(eventId: string, type: string): Promise<boolean>;
  /** Remove a recorded event id so Stripe retries can re-process. */
  delete(eventId: string): Promise<void>;
}

export interface Repos {
  users: UserRepo;
  entitlements: EntitlementRepo;
  tasks: TaskRepo;
  memories: MemoryRepo;
  aiRuns: AiRunRepo;
  sessions: SessionRepo;
  stripeEvents: StripeEventRepo;
}
