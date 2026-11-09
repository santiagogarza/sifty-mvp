import { SiftIllustration } from "@/components/marketing/sift-illustration";
import { buttonVariants } from "@/components/ui/button-variants";
import { getSession } from "@/lib/auth/session";
import { FREE_SIFTS_PER_DAY, PRO_TRIAL_DAYS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils/cn";
import { Check, ListChecks, PenLine, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.site");
  return { title: { absolute: t("title") }, alternates: { canonical: "/" } };
}

// Must be dynamic: a prerender has no cookies and would bake the signed-out
// landing page for everyone, so signed-in visitors never reach /today.
export const dynamic = "force-dynamic";

const STEPS = [
  { key: "capture", icon: PenLine },
  { key: "sift", icon: Sparkles },
  { key: "do", icon: ListChecks, soon: true },
] as const;

const TODAY = ["capture", "sifting", "views", "memory", "sync", "brief"] as const;

const NEXT = ["reminders", "execution", "connectors"] as const;

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect("/today");
  const t = await getTranslations("marketing");

  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-5 pt-10 pb-12 sm:px-6 sm:pt-16 sm:pb-16">
        <div className="max-w-2xl animate-rise">
          <div className="text-eyebrow mb-4">{t("landing.eyebrow")}</div>
          <h1 className="text-display text-[40px] sm:text-[56px] text-[var(--fg)]">
            {t.rich("landing.headline", { br: () => <br /> })}
          </h1>
          <p className="mt-5 text-[17px] sm:text-[19px] leading-[1.5] text-[var(--fg-muted)] max-w-xl">
            {t("landing.lede")}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "sm:min-w-[160px]")}
            >
              {t("landing.startFree")}
            </Link>
            <Link href="/pricing" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              {t("landing.seePricing")}
            </Link>
          </div>
          <p className="mt-3 text-[13px] text-[var(--fg-subtle)]">
            {t("landing.trialNote", { days: PRO_TRIAL_DAYS })}
          </p>
        </div>

        <div className="mt-12 sm:mt-16">
          <SiftIllustration />
        </div>
      </section>

      <section
        aria-labelledby="how-heading"
        className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 sm:py-16"
      >
        <div className="hairline mb-12" />
        <h2 id="how-heading" className="text-display text-[28px] sm:text-[34px] text-[var(--fg)]">
          {t("landing.how.heading")}
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.key} className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] text-[var(--fg-muted)]">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="text-num text-[12px] text-[var(--fg-subtle)]">0{i + 1}</span>
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] text-[var(--fg)]">
                    {t(`landing.how.${step.key}.title`)}
                  </h3>
                  {"soon" in step ? (
                    <span className="rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ai)]">
                      {t("rollingOut")}
                    </span>
                  ) : null}
                </div>
                <p className="text-[14px] leading-[1.55] text-[var(--fg-muted)]">
                  {t(`landing.how.${step.key}.body`)}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <section
        aria-labelledby="honest-heading"
        className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 sm:py-16"
      >
        <div className="hairline mb-12" />
        <h2
          id="honest-heading"
          className="text-display text-[28px] sm:text-[34px] text-[var(--fg)]"
        >
          {t("landing.honest.heading")}
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-[1.55] text-[var(--fg-muted)]">
          {t("landing.honest.body")}
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-eyebrow mb-3">{t("landing.honest.worksToday")}</div>
            <ul className="flex flex-col gap-2.5">
              {TODAY.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-[14.5px] leading-[1.5] text-[var(--fg)]"
                >
                  <Check
                    size={16}
                    className="mt-[3px] shrink-0 text-[var(--done)]"
                    aria-hidden="true"
                  />
                  <span>{t(`landing.honest.today.${item}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-eyebrow mb-3">{t("landing.honest.comingNext")}</div>
            <ul className="flex flex-col gap-2.5">
              {NEXT.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-[14.5px] leading-[1.5] text-[var(--fg-muted)]"
                >
                  <span
                    className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[var(--ai)]"
                    aria-hidden="true"
                  />
                  <span>{t(`landing.honest.next.${item}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] leading-[1.5] text-[var(--fg-subtle)]">
              {t("landing.honest.planNote", { count: FREE_SIFTS_PER_DAY })}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 sm:py-20">
        <div className="surface-card p-7 sm:p-10 text-center">
          <h2 className="text-display text-[28px] sm:text-[34px] text-[var(--fg)]">
            {t("landing.cta.heading")}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-[1.55] text-[var(--fg-muted)]">
            {t("landing.cta.body")}
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "min-w-[160px]")}
            >
              {t("landing.startFree")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
