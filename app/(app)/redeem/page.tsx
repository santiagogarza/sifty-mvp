import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { RedeemInviteForm } from "@/components/billing/redeem-invite-form";
import { getSession } from "@/lib/auth/session";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export async function generateMetadata() {
  const t = await getTranslations("account.redeem");
  return { title: t("title") };
}

/**
 * Landing page for invite links (`/redeem?code=sifty-…`). Signed-out
 * visitors are bounced through sign-in / sign-up with this URL as `next`,
 * so the code survives account creation.
 */
export default async function RedeemPage({
  searchParams,
}: {
  searchParams?: Promise<{ code?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const code = typeof params.code === "string" ? params.code.slice(0, 64) : "";

  const session = await getSession();
  if (!session) {
    const next = code ? `/redeem?code=${encodeURIComponent(code)}` : "/redeem";
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  const t = await getTranslations("account.redeem");

  return (
    <PageShell title={t("shellTitle")}>
      <PageHeader title={t("title")} description={t("description")} />
      <section className="surface-card p-5 max-w-lg">
        <RedeemInviteForm initialCode={code} autoSubmit={!!code} />
        <p className="text-[12.5px] text-[var(--fg-muted)] mt-4">
          {t.rich("later", {
            link: (chunks) => (
              <Link href="/settings/billing" className="text-[var(--accent)] hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    </PageShell>
  );
}
