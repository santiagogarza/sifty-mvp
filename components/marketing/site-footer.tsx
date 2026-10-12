import { SiftyWordmark } from "@/components/marketing/sifty-wordmark";
import { LEGAL_ENTITY, getSupportEmail } from "@/lib/site/config";
import Link from "next/link";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/sign-in", label: "Sign in" },
];

export function SiteFooter() {
  const support = getSupportEmail();
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 border-t border-[var(--border)]">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <SiftyWordmark />
          <p className="text-[13px] text-[var(--fg-muted)]">
            © {year} {LEGAL_ENTITY}. Sifty is in early access.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[var(--fg-muted)] hover:text-[var(--fg)] rounded-[4px]"
            >
              {l.label}
            </Link>
          ))}
          <a
            href={`mailto:${support}`}
            className="text-[var(--fg-muted)] hover:text-[var(--fg)] rounded-[4px]"
          >
            Support
          </a>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-5xl px-5 pb-8 text-[12.5px] text-[var(--fg-subtle)] sm:px-6">
        Questions or a problem? Email{" "}
        <a
          href={`mailto:${support}`}
          className="underline underline-offset-2 hover:text-[var(--fg)]"
        >
          {support}
        </a>
        . A person reads every message.
      </div>
    </footer>
  );
}
