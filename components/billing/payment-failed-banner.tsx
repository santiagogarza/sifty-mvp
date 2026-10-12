import type { PaymentProblem } from "@/lib/entitlements/entitlements";
import Link from "next/link";

/**
 * Persistent in-app notice while a subscription is in dunning. Not
 * dismissible on purpose: it goes away when the payment recovers (or the
 * user cancels), and hiding it would hide the only warning before Pro
 * turns off.
 */
export function PaymentFailedBanner({ problem }: { problem: PaymentProblem }) {
  const message =
    problem.kind === "grace"
      ? `Your last Sifty Pro payment didn't go through. Update your payment method by ${formatDay(problem.graceEndsAt)} to keep Pro.`
      : "Your Sifty Pro payment is still failing, so Pro is paused. Update your payment method to turn it back on.";
  return (
    <div
      role="alert"
      data-testid="payment-failed-banner"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 sm:px-6 md:px-8 py-2.5 text-[13px] text-[var(--fg)]"
    >
      <span>{message}</span>
      <Link
        href="/settings/billing"
        className="shrink-0 font-medium text-[var(--accent)] underline-offset-2 hover:underline"
      >
        Update payment method
      </Link>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
