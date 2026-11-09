import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { LEGAL_ENTITY } from "@/lib/site/config";
import { AlertTriangle } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import * as React from "react";

/**
 * Shared frame for /privacy and /terms: title, last-updated line, a draft
 * notice (the copy is a starting point for Santi's review, not reviewed
 * legal text), and a readable prose column. Translations also say the
 * English text prevails, since only the English version is reviewed.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("marketing.legal");
  const format = useFormatter();
  const translated = useLocale() !== DEFAULT_LOCALE;
  const date = format.dateTime(new Date(`${updated}T00:00:00Z`), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-16">
      <div className="text-eyebrow mb-4">{t("eyebrow")}</div>
      <h1 className="text-display text-[36px] sm:text-[44px] text-[var(--fg)]">{title}</h1>
      <p className="mt-3 text-[13.5px] text-[var(--fg-subtle)]">
        {t.rich("updated", { date, time: (chunks) => <time dateTime={updated}>{chunks}</time> })}
      </p>

      <div
        role="note"
        className="mt-6 flex gap-3 rounded-[var(--radius-lg)] border border-[var(--accent)]/40 bg-[var(--accent-soft)]/40 p-4 text-[13.5px] leading-[1.5] text-[var(--fg)]"
      >
        <AlertTriangle size={16} className="mt-[2px] shrink-0 text-[var(--accent)]" aria-hidden />
        <div className="flex flex-col gap-2">
          <p>
            {t.rich("draft", {
              entity: LEGAL_ENTITY,
              strong: (chunks) => <strong className="font-medium">{chunks}</strong>,
            })}
          </p>
          {translated ? <p>{t("translation")}</p> : null}
        </div>
      </div>

      <div className="legal-prose mt-10">{children}</div>
    </article>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-9 first:mt-0">
      <h2 id={`${id}-heading`} className="text-[20px] text-[var(--fg)]">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-[1.6] text-[var(--fg-muted)]">
        {children}
      </div>
    </section>
  );
}
