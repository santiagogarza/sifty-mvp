import { type StripeCustomerDeletion, deleteStripeCustomer } from "@/lib/billing/customers";
import type { Repos } from "@/lib/db/repos";
import type { AiRunRecord, EntitlementSnapshot, TaskEventRecord } from "@/lib/db/repos/types";
import type { Label, Memory, Task, UserProfile } from "@/lib/domain/types";

/**
 * Account lifecycle: everything the user owns, out or gone.
 *
 * Both operations are scoped by `userId` through the repos, so the tenancy
 * invariant (`tests/db/tenancy.test.ts`) is what keeps one user from
 * exporting or deleting another's data. The route layer supplies the
 * session's user id and never accepts one from the request.
 */

export const EXPORT_FORMAT_VERSION = 1;

/**
 * Hard ceilings on the append-only histories so one request can never
 * read or serialize an unbounded result set. Tasks, labels and memories
 * are bounded by what a person can create by hand; runs and events grow
 * with every sift, so they are capped and the export says when it was.
 */
export const EXPORT_LIMITS = {
  aiRuns: 10_000,
  taskEvents: 10_000,
} as const;

export interface AccountExport {
  format: "sifty-export";
  version: number;
  exportedAt: string;
  user: UserProfile;
  entitlement: EntitlementSnapshot | null;
  tasks: Task[];
  labels: Label[];
  memories: Memory[];
  taskEvents: TaskEventRecord[];
  aiRuns: AiRunRecord[];
  /** Lists that hit their ceiling; the newest `aiRuns` / oldest `taskEvents` are included. */
  truncated: Array<"aiRuns" | "taskEvents">;
}

export async function exportAccount(repos: Repos, userId: string): Promise<AccountExport | null> {
  const user = await repos.users.getById(userId);
  if (!user) return null;
  const [entitlement, tasks, labels, memories, taskEvents, aiRuns] = await Promise.all([
    repos.entitlements.get(userId),
    repos.tasks.list(userId),
    repos.labels.list(userId),
    repos.memories.list(userId),
    repos.taskEvents.list(userId, EXPORT_LIMITS.taskEvents),
    repos.aiRuns.list(userId, EXPORT_LIMITS.aiRuns),
  ]);
  const truncated: AccountExport["truncated"] = [];
  if (aiRuns.length >= EXPORT_LIMITS.aiRuns) truncated.push("aiRuns");
  if (taskEvents.length >= EXPORT_LIMITS.taskEvents) truncated.push("taskEvents");
  return {
    format: "sifty-export",
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    user,
    entitlement,
    tasks,
    labels,
    memories,
    taskEvents,
    aiRuns,
    truncated,
  };
}

export interface AccountDeletion {
  stripeCustomer: StripeCustomerDeletion | "none";
}

/**
 * Which step of the deletion failed, and whether Stripe had already acted,
 * so the caller can say exactly what state the account is in.
 */
export class AccountDeletionError extends Error {
  constructor(
    readonly stage: "billing" | "database",
    readonly stripeCustomer: AccountDeletion["stripeCustomer"],
    cause: unknown,
  ) {
    super(stage === "billing" ? "Stripe customer deletion failed" : "Account row deletion failed", {
      cause,
    });
    this.name = "AccountDeletionError";
  }
}

/** Thrown when the account is the creator: see `deleteAccount`. */
export class CreatorAccountError extends Error {
  constructor() {
    super("The creator account cannot be deleted from the app");
    this.name = "CreatorAccountError";
  }
}

/**
 * Stripe first, then the database: if Stripe refuses, nothing local is
 * touched and the caller can report a retryable failure. A database
 * failure after the Stripe step leaves an account whose billing is already
 * cancelled; the error carries that. Returns null when the user does not
 * exist.
 *
 * The creator account is refused outright: its row is the only thing that
 * holds `CREATOR_EMAIL`, and sign-up grants the creator tier to whoever
 * registers that address next. Deleting it would hand the unlimited tier
 * to an anonymous caller.
 */
export async function deleteAccount(repos: Repos, userId: string): Promise<AccountDeletion | null> {
  const user = await repos.users.getById(userId);
  if (!user) return null;
  if (user.isCreator) throw new CreatorAccountError();
  const entitlement = await repos.entitlements.get(userId);
  let stripeCustomer: AccountDeletion["stripeCustomer"] = "none";
  if (entitlement?.stripeCustomerId) {
    try {
      stripeCustomer = await deleteStripeCustomer(entitlement.stripeCustomerId, { userId });
    } catch (err) {
      throw new AccountDeletionError("billing", "none", err);
    }
  }
  try {
    await repos.users.delete(userId);
  } catch (err) {
    throw new AccountDeletionError("database", stripeCustomer, err);
  }
  return { stripeCustomer };
}
