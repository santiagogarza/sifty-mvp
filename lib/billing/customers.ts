import { reportError } from "@/lib/observability/report-error";
import { StripeNotConfiguredError, getStripe } from "./stripe";

export type StripeCustomerDeletion = "deleted" | "skipped";

/**
 * Delete a Stripe customer as part of account deletion. Stripe cancels the
 * customer's subscriptions immediately, so this must run before the local
 * rows go away — a failure here aborts the whole deletion rather than
 * leaving a billing relationship with no account behind it.
 *
 * Without Stripe keys there is nothing to call; the caller proceeds. A
 * customer Stripe no longer knows counts as deleted.
 */
export async function deleteStripeCustomer(
  customerId: string,
  ctx: { userId: string },
): Promise<StripeCustomerDeletion> {
  let stripe: ReturnType<typeof getStripe>;
  try {
    stripe = getStripe();
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      reportError(err, {
        area: "billing.customer_delete",
        userId: ctx.userId,
        tags: { customerId, outcome: "skipped" },
      });
      return "skipped";
    }
    throw err;
  }
  try {
    await stripe.customers.del(customerId);
    return "deleted";
  } catch (err) {
    if (isResourceMissing(err)) return "deleted";
    throw err;
  }
}

function isResourceMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "resource_missing"
  );
}
