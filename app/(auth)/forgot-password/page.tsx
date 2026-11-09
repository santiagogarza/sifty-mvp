import { ForgotPasswordForm } from "@/components/auth/password-forms";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("auth.forgotPassword");
  return { title: { absolute: t("metaTitle") } };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgotPassword");
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">{t("title")}</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">{t("description")}</p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        <Link href="/sign-in" className="text-[var(--accent)] hover:underline">
          {t("backToSignIn")}
        </Link>
      </div>
    </div>
  );
}
