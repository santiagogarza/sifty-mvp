import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { BillingPanel } from "@/components/billing/billing-panel";
import { countAiRunsToday } from "@/lib/ai/ai-runs";
import { getSession } from "@/lib/auth/session";
import { hasOpenStripeSubscription } from "@/lib/billing/events";
import { getBillingStatus } from "@/lib/billing/stripe";
import { deriveEntitlement, paymentProblem } from "@/lib/entitlements/entitlements";
import { redirect } from "next/navigation";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings/billing");
  }

  const entitlement = deriveEntitlement({
    profile: session.user,
    snapshot: session.entitlement,
    siftsToday: await countAiRunsToday(session.user.id),
  });
  const snapshot = session.entitlement;

  return (
    <PageShell title="Billing">
      <PageHeader
        title="Billing"
        description="Free covers capture, organize, and sync. Pro is unlimited sifting."
      />
      <BillingPanel
        user={{ email: session.user.email, isCreator: session.user.isCreator }}
        entitlement={entitlement}
        billingConfigured={getBillingStatus().configured}
        stripe={{
          customer: !!snapshot?.stripeCustomerId,
          open: hasOpenStripeSubscription(snapshot),
          active: snapshot?.subscriptionActive ?? false,
          status: snapshot?.stripeStatus ?? null,
          currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
        }}
        paymentProblem={paymentProblem(snapshot, session.user.isCreator)}
      />
    </PageShell>
  );
}
