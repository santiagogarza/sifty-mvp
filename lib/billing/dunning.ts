import type { StripeInvoiceLike } from "@/lib/billing/events";
import type { UserProfile } from "@/lib/domain/types";
import { appUrl, sendTemplate } from "@/lib/email/templates";
import { reportError } from "@/lib/observability/report-error";

/**
 * Dunning mail for one failed invoice. Stripe retries the charge on its
 * own schedule and fires `invoice.payment_failed` per attempt, so this is
 * sent once per event: the Stripe event id doubles as the provider-side
 * idempotency key, and the webhook's `stripe_events` dedupe stops replays
 * from reaching here at all.
 *
 * Delivery failures are reported, not thrown: the entitlement change is the
 * part that must not be lost, and a 5xx here would make Stripe replay the
 * event for three days against a mail outage we already know about.
 */
export async function sendPaymentFailedEmail(args: {
  user: Pick<UserProfile, "email" | "displayName">;
  invoice: StripeInvoiceLike;
  /** Open grace deadline, or null when no window is open. */
  graceEndsAt: string | null;
  /** Pro is already off (grace consumed or never opened); the copy must say so. */
  accessPaused: boolean;
  eventId: string;
}): Promise<boolean> {
  try {
    await sendTemplate("payment-failed", {
      to: args.user.email,
      idempotencyKey: `payment-failed:${args.eventId}`,
      props: {
        name: args.user.displayName,
        amount: formatMoney(args.invoice.amount_due, args.invoice.currency),
        retryUntil: args.graceEndsAt,
        accessPaused: args.accessPaused,
        billingUrl: `${appUrl()}/settings/billing`,
      },
    });
    return true;
  } catch (err) {
    reportError(err, { area: "billing.dunning", tags: { eventId: args.eventId } });
    return false;
  }
}

export function formatMoney(amountCents: number | undefined, currency: string | undefined): string {
  const code = (currency ?? "usd").toUpperCase();
  const cents = amountCents ?? 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}
