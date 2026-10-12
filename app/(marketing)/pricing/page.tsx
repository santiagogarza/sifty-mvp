import { PricingCards } from "@/components/marketing/pricing-cards";
import { FREE_SIFTS_PER_DAY, PRO_TRIAL_DAYS } from "@/lib/billing/plans";
import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION = `Sifty is free to capture, organize, and sync, with ${FREE_SIFTS_PER_DAY} AI sifts a day. Pro removes the cap and adds autonomous execution.`;

export const metadata: Metadata = {
  title: "Pricing",
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Sifty pricing", description: DESCRIPTION, url: "/pricing" },
};

const FAQ = [
  {
    q: "What is a sift?",
    a: "One pass of Sifty's AI over a task: it fills in details, sets priority and labels, picks a due date, breaks the work into steps, and explains why. Re-running on the same task counts as another sift.",
  },
  {
    q: "What happens when my trial ends?",
    a: `Your account becomes a Free account. Everything you captured stays, sync keeps working, and you get ${FREE_SIFTS_PER_DAY} sifts a day. Nothing is deleted and you are never charged without choosing a plan.`,
  },
  {
    q: "Can I cancel?",
    a: "Yes, from Settings → Billing at any time. You keep Pro until the end of the period you paid for, then move to Free.",
  },
  {
    q: "What does \u201crolling out\u201d mean?",
    a: "Those features are being built now and will switch on for Pro accounts as they ship. We list them so you know what you are paying toward, not to charge you for them before they exist.",
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <div className="text-eyebrow mb-4">Pricing</div>
        <h1 className="text-display text-[36px] sm:text-[48px] text-[var(--fg)]">
          Free to capture. Pay when Sifty does the work.
        </h1>
        <p className="mt-4 text-[16px] sm:text-[17px] leading-[1.5] text-[var(--fg-muted)]">
          Every new account starts with {PRO_TRIAL_DAYS} days of Pro, no card. Prices are in USD and
          may change before launch; your current plan is always shown in Settings.
        </p>
      </div>

      <div className="mt-10">
        <PricingCards />
      </div>

      <p className="mt-6 text-[14px] text-[var(--fg-muted)]">
        Have an invite code?{" "}
        <Link
          href="/redeem"
          className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80 rounded-[4px]"
        >
          Redeem it here
        </Link>
        .
      </p>

      <section aria-labelledby="faq-heading" className="mt-16">
        <div className="hairline mb-10" />
        <h2 id="faq-heading" className="text-display text-[26px] sm:text-[30px] text-[var(--fg)]">
          Questions
        </h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-[15px] text-[var(--fg)]">{item.q}</dt>
              <dd className="mt-1.5 text-[14px] leading-[1.55] text-[var(--fg-muted)]">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
