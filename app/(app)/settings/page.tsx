import { SettingsClient } from "@/components/settings/settings-client";
import { countAiRunsToday } from "@/lib/ai/ai-runs";
import { getSession } from "@/lib/auth/session";
import { deriveEntitlement } from "@/lib/entitlements/entitlements";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings");
  }

  const entitlement = deriveEntitlement({
    profile: session.user,
    snapshot: session.entitlement,
    siftsToday: await countAiRunsToday(session.user.id),
  });

  return (
    <SettingsClient
      account={{
        email: session.user.email,
        displayName: session.user.displayName,
        entitlement,
        authBypass: session.sessionId === null,
      }}
    />
  );
}
