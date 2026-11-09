import { LegalPage, Section } from "@/components/marketing/legal-page";
import { LEGAL_ENTITY, getSupportEmail, pageMetadata } from "@/lib/site/config";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.terms");
  return pageMetadata({
    title: t("title"),
    description: t("metaDescription", { entity: LEGAL_ENTITY }),
    path: "/terms",
  });
}

const UPDATED = "2026-10-12";

export default async function TermsPage() {
  const t = await getTranslations("marketing.terms");
  const support = getSupportEmail();
  return (
    <LegalPage title={t("title")} updated={UPDATED}>
      <Section id="agreement" title={t("agreement.title")}>
        <p>{t("agreement.body", { entity: LEGAL_ENTITY })}</p>
      </Section>

      <Section id="service" title={t("service.title")}>
        <p>{t("service.body")}</p>
      </Section>

      <Section id="account" title={t("account.title")}>
        <p>{t("account.body")}</p>
      </Section>

      <Section id="content" title={t("content.title")}>
        <p>
          {t.rich("content.body", {
            link: (chunks) => (
              <Link href="/privacy" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="ai" title={t("ai.title")}>
        <p>{t("ai.body")}</p>
      </Section>

      <Section id="acceptable" title={t("acceptable.title")}>
        <p>{t("acceptable.intro")}</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>{t("acceptable.law")}</li>
          <li>{t("acceptable.interfere")}</li>
          <li>{t("acceptable.resell")}</li>
          <li>{t("acceptable.rights")}</li>
        </ul>
        <p>{t("acceptable.research")}</p>
      </Section>

      <Section id="plans" title={t("plans.title")}>
        <p>{t("plans.body")}</p>
      </Section>

      <Section id="termination" title={t("termination.title")}>
        <p>
          {t.rich("termination.body", {
            address: support,
            email: (chunks) => (
              <a href={`mailto:${support}`} className="underline underline-offset-2">
                {chunks}
              </a>
            ),
          })}
        </p>
      </Section>

      <Section id="warranty" title={t("warranty.title")}>
        <p>{t("warranty.body")}</p>
      </Section>

      <Section id="law" title={t("law.title")}>
        <p>
          {t("law.body")}
          <span className="block mt-2 text-[13px] text-[var(--fg-subtle)]">
            {t("law.reviewNote", { entity: LEGAL_ENTITY })}
          </span>
        </p>
      </Section>

      <Section id="changes" title={t("changes.title")}>
        <p>{t("changes.body")}</p>
      </Section>
    </LegalPage>
  );
}
