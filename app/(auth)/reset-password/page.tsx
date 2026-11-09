import { ResetPasswordForm } from "@/components/auth/password-forms";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("auth.resetPassword");
  return { title: { absolute: t("metaTitle") } };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const invalid = !params.token || !!params.error;
  const t = await getTranslations("auth.resetPassword");
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">{t("title")}</h1>
      {invalid ? (
        <>
          <p role="alert" className="text-[13.5px] text-[var(--warn)] mt-2">
            {t("invalidLink")}
          </p>
          <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
            <Link href="/forgot-password" className="text-[var(--accent)] hover:underline">
              {t("requestNewLink")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">{t("description")}</p>
          <div className="mt-6">
            <ResetPasswordForm token={params.token!} />
          </div>
        </>
      )}
    </div>
  );
}
