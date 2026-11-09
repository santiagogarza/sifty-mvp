import { PricingCards } from "@/components/marketing/pricing-cards";
import { FREE_SIFTS_PER_DAY, PRO_TRIAL_DAYS } from "@/lib/billing/plans";
import { pageMetadata } from "@/lib/site/config";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.pricing");
  return pageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription", { count: FREE_SIFTS_PER_DAY }),
    path: "/pricing",
  });
}

const FAQ = ["sift", "trialEnds", "cancel", "rollingOut"] as const;

export default async function PricingPage() {
  const t = await getTranslations("marketing.pricing");
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <div className="text-eyebrow mb-4">{t("eyebrow")}</div>
        <h1 className="text-display text-[36px] sm:text-[48px] text-[var(--fg)]">
          {t("headline")}
        </h1>
        <p className="mt-4 text-[16px] sm:text-[17px] leading-[1.5] text-[var(--fg-muted)]">
          {t("lede", { days: PRO_TRIAL_DAYS })}
        </p>
      </div>

      <div className="mt-10">
        <PricingCards />
      </div>

      <p className="mt-6 text-[14px] text-[var(--fg-muted)]">
        {t.rich("invite", {
          link: (chunks) => (
            <Link
              href="/redeem"
              className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80 rounded-[4px]"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>

      <section aria-labelledby="faq-heading" className="mt-16">
        <div className="hairline mb-10" />
        <h2 id="faq-heading" className="text-display text-[26px] sm:text-[30px] text-[var(--fg)]">
          {t("faqHeading")}
        </h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
          {FAQ.map((key) => (
            <div key={key}>
              <dt className="text-[15px] text-[var(--fg)]">{t(`faq.${key}.q`)}</dt>
              <dd className="mt-1.5 text-[14px] leading-[1.55] text-[var(--fg-muted)]">
                {t(`faq.${key}.a`, { count: FREE_SIFTS_PER_DAY })}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
