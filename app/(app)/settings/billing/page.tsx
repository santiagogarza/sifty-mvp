import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { BillingPanel } from "@/components/billing/billing-panel";
import { countAiRunsToday } from "@/lib/ai/ai-runs";
import { getSession } from "@/lib/auth/session";
import { deriveEntitlement } from "@/lib/entitlements/entitlements";
import { redirect } from "next/navigation";

export const metadata = { title: "Billing — Sifty" };

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

  return (
    <PageShell title="Billing">
      <PageHeader
        title="Billing"
        description="Free covers capture, organize, and sync. Pro is unlimited sifting."
      />
      <BillingPanel
        user={{ email: session.user.email, isCreator: session.user.isCreator }}
        entitlement={entitlement}
        hasSubscription={!!session.entitlement?.stripeSubscriptionId}
      />
    </PageShell>
  );
}
