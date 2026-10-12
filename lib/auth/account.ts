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
}

export async function exportAccount(repos: Repos, userId: string): Promise<AccountExport | null> {
  const user = await repos.users.getById(userId);
  if (!user) return null;
  const [entitlement, tasks, labels, memories, taskEvents, aiRuns] = await Promise.all([
    repos.entitlements.get(userId),
    repos.tasks.list(userId),
    repos.labels.list(userId),
    repos.memories.list(userId),
    repos.taskEvents.list(userId),
    repos.aiRuns.list(userId),
  ]);
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
  };
}

export interface AccountDeletion {
  stripeCustomer: StripeCustomerDeletion | "none";
}

/** Which step of the deletion failed, so the caller can say what state the account is in. */
export class AccountDeletionError extends Error {
  constructor(
    readonly stage: "billing" | "database",
    cause: unknown,
  ) {
    super(stage === "billing" ? "Stripe customer deletion failed" : "Account row deletion failed", {
      cause,
    });
    this.name = "AccountDeletionError";
  }
}

/**
 * Stripe first, then the database: if Stripe refuses, nothing local is
 * touched and the caller can report a retryable failure. A database
 * failure after the Stripe step leaves an account whose billing is already
 * cancelled; the error says so. Returns null when the user does not exist.
 */
export async function deleteAccount(repos: Repos, userId: string): Promise<AccountDeletion | null> {
  const user = await repos.users.getById(userId);
  if (!user) return null;
  const entitlement = await repos.entitlements.get(userId);
  let stripeCustomer: AccountDeletion["stripeCustomer"] = "none";
  if (entitlement?.stripeCustomerId) {
    try {
      stripeCustomer = await deleteStripeCustomer(entitlement.stripeCustomerId, { userId });
    } catch (err) {
      throw new AccountDeletionError("billing", err);
    }
  }
  try {
    await repos.users.delete(userId);
  } catch (err) {
    throw new AccountDeletionError("database", err);
  }
  return { stripeCustomer };
}
