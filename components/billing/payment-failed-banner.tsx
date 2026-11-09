import type { PaymentProblem } from "@/lib/entitlements/entitlements";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";

/**
 * Persistent in-app notice while a subscription is in dunning. Not
 * dismissible on purpose: it goes away when the payment recovers (or the
 * user cancels), and hiding it would hide the only warning before Pro
 * turns off.
 */
export function PaymentFailedBanner({ problem }: { problem: PaymentProblem }) {
  const t = useTranslations("account.paymentBanner");
  const format = useFormatter();
  // UTC, like `formatBillingDay`, so the banner names the same day as the email.
  const message =
    problem.kind === "grace"
      ? t("grace", {
          date: format.dateTime(new Date(problem.graceEndsAt), {
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }),
        })
      : t("lapsed");
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
        {t("update")}
      </Link>
    </div>
  );
}
