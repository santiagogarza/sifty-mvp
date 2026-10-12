import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { ConnectionsPanel } from "@/components/settings/connections-panel";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Connections" };

const MAX_NOTICE_CHARS = 240;

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in?next=/settings/connections");
  }
  const params = (await searchParams) ?? {};
  const notice = params.connected
    ? ({ kind: "connected", provider: params.connected } as const)
    : params.error
      ? ({ kind: "error", message: describeError(params.error) } as const)
      : null;

  return (
    <PageShell title="Connections">
      <PageHeader
        title="Connections"
        description="Give Sifty a way into the tools where your work actually happens. Reading is automatic; anything that changes something waits for your approval."
      />
      <ConnectionsPanel notice={notice} />
    </PageShell>
  );
}

/** `<provider>:<reason>` from the callback → one readable sentence. */
function describeError(raw: string): string {
  const idx = raw.indexOf(":");
  const provider = idx > 0 ? raw.slice(0, idx) : null;
  const reason = (idx > 0 ? raw.slice(idx + 1) : raw).trim().slice(0, MAX_NOTICE_CHARS);
  const name = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "The service";
  if (!reason || reason === "access_denied" || /user_cancel|denied/i.test(reason)) {
    return `${name} wasn't connected — the request was cancelled or declined.`;
  }
  return `${name} wasn't connected: ${reason}`;
}
