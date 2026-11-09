import { AuthForm } from "@/components/auth/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth/auth";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("auth.signIn");
  return { title: { absolute: t("metaTitle") } };
}

const ERROR_KEYS = [
  "INVALID_TOKEN",
  "EXPIRED_TOKEN",
  "signup_disabled",
  "account_not_linked",
] as const;
type ErrorKey = (typeof ERROR_KEYS)[number];

function isErrorKey(value: string): value is ErrorKey {
  return (ERROR_KEYS as readonly string[]).includes(value);
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string; reset?: string; deleted?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const t = await getTranslations("auth.signIn");
  const banner = params.error
    ? t(`errors.${isErrorKey(params.error) ? params.error : "generic"}`)
    : params.reset
      ? t("passwordUpdated")
      : params.deleted === "1"
        ? t("accountDeleted")
        : null;
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">{t("title")}</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">{t("description")}</p>
      {banner ? (
        <div
          role="alert"
          className={`mt-4 text-[13px] ${params.error ? "text-[var(--warn)]" : "text-[var(--fg)]"}`}
        >
          {banner}
        </div>
      ) : null}
      <div className="mt-6">
        <AuthForm mode="sign-in" next={params.next} googleEnabled={isGoogleAuthEnabled()} />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        {t.rich("newHere", {
          link: (chunks) => (
            <Link
              href={params.next ? `/sign-up?next=${encodeURIComponent(params.next)}` : "/sign-up"}
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
