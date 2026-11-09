import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { getSession } from "@/lib/auth/session";
import { getPushConfig } from "@/lib/notifications/push";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export async function generateMetadata() {
  const t = await getTranslations("account.notifications");
  return { title: t("title") };
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ unsubscribed?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings/notifications");
  }
  const params = (await searchParams) ?? {};
  const t = await getTranslations("account.notifications");
  return (
    <PageShell title={t("title")}>
      <PageHeader title={t("title")} description={t("description")} />
      <NotificationsPanel
        email={session.user.email}
        vapidPublicKey={getPushConfig()?.publicKey ?? null}
        unsubscribed={params.unsubscribed ?? null}
      />
    </PageShell>
  );
}
