import { AppFrame } from "@/components/app-shell/app-frame";
<<<<<<< HEAD
import { getSession } from "@/lib/auth/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Authoritative gate for the signed-in app. The middleware only checks that
 * a session cookie exists; this validates it against the session table (or
 * yields the bypass session under `SIFTY_DISABLE_AUTH=1`).
 *
 * Must be dynamic: a prerender has no cookies and would bake the redirect
 * into the static page.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get("x-sifty-path");
    redirect(path ? `/sign-in?next=${encodeURIComponent(path)}` : "/sign-in");
  }
  return <AppFrame>{children}</AppFrame>;
=======
import { PaymentFailedBanner } from "@/components/billing/payment-failed-banner";
import { getSession } from "@/lib/auth/session";
import { paymentProblem } from "@/lib/entitlements/entitlements";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const problem = paymentProblem(session?.entitlement ?? null, session?.user.isCreator ?? false);
  return (
    <AppFrame notice={problem ? <PaymentFailedBanner problem={problem} /> : null}>
      {children}
    </AppFrame>
  );
>>>>>>> 71a95fd (billing: dunning grace period, failed-payment email and banner, expireGracePeriods cron)
}
