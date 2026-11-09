import { AuthForm } from "@/components/auth/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth/auth";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("auth.signUp");
  return { title: { absolute: t("metaTitle") } };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const t = await getTranslations("auth.signUp");
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">{t("title")}</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">{t("description")}</p>
      <div className="mt-6">
        <AuthForm mode="sign-up" next={params.next} googleEnabled={isGoogleAuthEnabled()} />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        {t.rich("haveAccount", {
          link: (chunks) => (
            <Link
              href={params.next ? `/sign-in?next=${encodeURIComponent(params.next)}` : "/sign-in"}
              className="text-[var(--accent)] hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </div>
    </div>
  );
}
