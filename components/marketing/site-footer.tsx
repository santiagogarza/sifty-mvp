import { SiftyWordmark } from "@/components/marketing/sifty-wordmark";
import { LEGAL_ENTITY, getSupportEmail } from "@/lib/site/config";
import { useTranslations } from "next-intl";
import Link from "next/link";

const LINKS = [
  { href: "/pricing", key: "pricing" },
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/sign-in", key: "signIn" },
] as const;

export function SiteFooter() {
  const t = useTranslations("marketing.footer");
  const support = getSupportEmail();
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 border-t border-[var(--border)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <SiftyWordmark />
          <p className="text-[13px] text-[var(--fg-muted)]">
            {t("copyright", { year: String(year), entity: LEGAL_ENTITY })}
          </p>
        </div>
        <nav aria-label={t("navLabel")} className="flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[var(--fg-muted)] hover:text-[var(--fg)] rounded-[4px]"
            >
              {t(l.key)}
            </Link>
          ))}
          <a
            href={`mailto:${support}`}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)] rounded-[4px]"
          >
            {t("support")}
          </a>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-5xl px-5 pb-8 text-[12.5px] text-[var(--fg-subtle)] sm:px-6">
        {t.rich("contact", {
          address: support,
          email: (chunks) => (
            <a
              href={`mailto:${support}`}
              className="underline underline-offset-2 hover:text-[var(--fg)]"
            >
              {chunks}
            </a>
          ),
        })}
      </div>
    </footer>
  );
}
