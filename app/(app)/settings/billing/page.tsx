import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { BillingPanel } from "@/components/billing/billing-panel";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { redirect } from "next/navigation";

export const metadata = { title: "Billing — Sifty" };

export default async function BillingPage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings/billing");
  }

  const repos = getRepos();
  const entitlement = await repos.entitlements.get(session.user.id);

  return (
    <PageShell title="Billing">
      <PageHeader
        title="Billing"
        description="Sifty Pro: Claude/GPT access, higher daily caps, support."
      />
      <BillingPanel
        user={{
          email: session.user.email,
          isCreator: session.user.isCreator,
        }}
        entitlement={entitlement}
      />
    </PageShell>
  );
}
