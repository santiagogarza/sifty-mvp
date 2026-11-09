import { LegalPage, Section } from "@/components/marketing/legal-page";
import { LEGAL_ENTITY, PROCESSORS, getSupportEmail, pageMetadata } from "@/lib/site/config";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type * as React from "react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.privacy");
  return pageMetadata({
    title: t("title"),
    description: t("metaDescription", { entity: LEGAL_ENTITY }),
    path: "/privacy",
  });
}

const UPDATED = "2026-10-12";

const strong = (chunks: React.ReactNode) => (
  <strong className="text-[var(--fg)] font-medium">{chunks}</strong>
);

export default async function PrivacyPage() {
  const t = await getTranslations("marketing.privacy");
  const support = getSupportEmail();
  const email = (chunks: React.ReactNode) => (
    <a href={`mailto:${support}`} className="underline underline-offset-2">
      {chunks}
    </a>
  );
  return (
    <LegalPage title={t("title")} updated={UPDATED}>
      <Section id="who" title={t("who.title")}>
        <p>{t.rich("who.body", { entity: LEGAL_ENTITY, address: support, email })}</p>
      </Section>

      <Section id="collect" title={t("collect.title")}>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>{t.rich("collect.account", { strong })}</li>
          <li>{t.rich("collect.content", { strong })}</li>
          <li>{t.rich("collect.usage", { strong })}</li>
          <li>{t.rich("collect.billing", { strong })}</li>
          <li>{t.rich("collect.technical", { strong })}</li>
        </ul>
        <p>{t("collect.noSelling")}</p>
      </Section>

      <Section id="use" title={t("use.title")}>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>{t("use.provide")}</li>
          <li>{t("use.account")}</li>
          <li>{t("use.health")}</li>
        </ul>
        <p>{t("use.noTraining")}</p>
      </Section>

      <Section id="ai" title={t("ai.title")}>
        <p>{t("ai.sifting")}</p>
        <p>{t("ai.execution")}</p>
      </Section>

      <Section id="processors" title={t("processors.title")}>
        <p>{t("processors.intro")}</p>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
          <table className="w-full text-[14px]">
            <thead className="bg-[var(--surface-muted)] text-left text-[var(--fg)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("processors.provider")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("processors.purpose")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("processors.location")}
                </th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--fg)]">{p.name}</td>
                  <td className="px-3 py-2">{t(`processors.purposes.${p.id}`)}</td>
                  <td className="px-3 py-2">{t(`processors.regions.${p.region}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{t("processors.transfer")}</p>
      </Section>

      <Section id="cookies" title={t("cookies.title")}>
        <p>
          {t.rich("cookies.body", {
            code: (chunks) => <code className="font-mono text-[13px]">{chunks}</code>,
          })}
        </p>
      </Section>

      <Section id="retention" title={t("retention.title")}>
        <p>{t("retention.body")}</p>
      </Section>

      <Section id="rights" title={t("rights.title")}>
        <p>{t.rich("rights.body", { address: support, email })}</p>
      </Section>

      <Section id="security" title={t("security.title")}>
        <p>
          {t.rich("security.body", {
            link: (chunks) => (
              <Link href="/.well-known/security.txt" className="underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </Section>

      <Section id="children" title={t("children.title")}>
        <p>{t("children.body")}</p>
      </Section>

      <Section id="changes" title={t("changes.title")}>
        <p>{t("changes.body")}</p>
      </Section>
    </LegalPage>
  );
}
