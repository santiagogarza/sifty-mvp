import { SettingsClient } from "@/components/settings/settings-client";
import { countAiRunsToday } from "@/lib/ai/ai-runs";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { deriveEntitlement } from "@/lib/entitlements/entitlements";
import { redirect } from "next/navigation";

export const metadata = { title: "Settings — Sifty" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings");
  }

  const ent = await getRepos().entitlements.get(session.user.id);
  const entitlement = deriveEntitlement({
    profile: session.user,
    trialStartedAt: session.trialStartedAt,
    subscriptionActive: session.subscriptionActive,
    aiRunsToday: await countAiRunsToday(session.user.id),
  });

  return (
    <SettingsClient
      account={{
        email: session.user.email,
        displayName: session.user.displayName,
        tier: entitlement.tier,
        trialEndsAt: ent?.trialEndsAt ?? entitlement.trialEndsAt,
        authBypass: session.sessionId === null,
      }}
    />
  );
}
