import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { getSession } from "@/lib/auth/session";
import { getPushConfig } from "@/lib/notifications/push";
import { redirect } from "next/navigation";

export const metadata = { title: "Notifications" };

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
  return (
    <PageShell title="Notifications">
      <PageHeader
        title="Notifications"
        description="A morning plan, a nudge for what is due, and a weekly review — by email, as a notification, or both. Nothing else."
      />
      <NotificationsPanel
        email={session.user.email}
        vapidPublicKey={getPushConfig()?.publicKey ?? null}
        unsubscribed={params.unsubscribed ?? null}
      />
    </PageShell>
  );
}
