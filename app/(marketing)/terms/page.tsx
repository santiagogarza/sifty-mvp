import { LegalPage, Section } from "@/components/marketing/legal-page";
import { LEGAL_ENTITY, getSupportEmail } from "@/lib/site/config";
import type { Metadata } from "next";
import Link from "next/link";

const DESCRIPTION = `The terms under which ${LEGAL_ENTITY} provides Sifty.`;

export const metadata: Metadata = {
  title: "Terms of service",
  description: DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: { title: "Sifty terms of service", description: DESCRIPTION, url: "/terms" },
};

const UPDATED = "2026-10-12";

export default function TermsPage() {
  const support = getSupportEmail();
  return (
    <LegalPage title="Terms of service" updated={UPDATED}>
      <Section id="agreement" title="The agreement">
        <p>
          These terms are a contract between you and {LEGAL_ENTITY} (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;) covering your use of Sifty, the website, and the apps. By creating an
          account you agree to them. If you are using Sifty for an organization, you confirm you can
          bind that organization.
        </p>
      </Section>

      <Section id="service" title="What Sifty is">
        <p>
          Sifty is a task tool that uses AI to organize, prioritize, and break down what you
          capture, and, as those features ship, to carry out work on your behalf. It is in early
          access: features change, some are labeled &ldquo;rolling out&rdquo; before they exist, and
          occasional downtime or bugs are likely. We will be straightforward about what works.
        </p>
      </Section>

      <Section id="account" title="Your account">
        <p>
          You need an account to use Sifty. Keep your password private and tell us right away if you
          think someone else is using your account. You are responsible for activity under it. You
          must be at least 16 years old.
        </p>
      </Section>

      <Section id="content" title="Your content">
        <p>
          You own what you put into Sifty and what Sifty produces from it. You give us only the
          permission we need to store, process, sync, and display that content to run the service
          for you, including sending task text to AI providers as described in the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>
          . We do not use your content to train AI models.
        </p>
      </Section>

      <Section id="ai" title="AI output and autonomous actions">
        <p>
          AI output can be wrong. Priorities, due dates, summaries, and drafts are suggestions;
          check anything that matters before you rely on it. When autonomous execution launches,
          Sifty will only act through tools you explicitly connect and, by default, will prepare
          work for your approval rather than send or submit anything itself. You remain responsible
          for what you approve.
        </p>
      </Section>

      <Section id="acceptable" title="Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>break the law, or use Sifty to harass, defraud, or harm anyone;</li>
          <li>probe, overload, or interfere with the service or other people&rsquo;s accounts;</li>
          <li>resell access, scrape the service, or build a competing product from our output;</li>
          <li>upload content you have no right to share.</li>
        </ul>
        <p>Security research is welcome; see our security.txt for how to report findings.</p>
      </Section>

      <Section id="plans" title="Plans, trials, and payment">
        <p>
          New accounts get a Pro trial with no card required. When it ends you move to the Free plan
          unless you subscribe. Paid plans are billed in advance through Stripe, monthly or yearly,
          and renew automatically until you cancel in Settings → Billing. Cancelling keeps Pro until
          the end of the period you paid for. We do not offer refunds for partial periods except
          where the law requires it. Prices may change; we will tell you at least 30 days before a
          change affects a renewal. Invite codes grant the access stated when issued and may be
          revoked if misused.
        </p>
      </Section>

      <Section id="termination" title="Ending the relationship">
        <p>
          You can stop using Sifty and ask us to delete your account at any time by emailing{" "}
          <a href={`mailto:${support}`} className="underline underline-offset-2">
            {support}
          </a>
          . We may suspend or close accounts that break these terms, with notice where practical. If
          we shut Sifty down, we will give you at least 30 days&rsquo; notice and a way to export
          your data.
        </p>
      </Section>

      <Section id="warranty" title="Warranty and liability">
        <p>
          Sifty is provided &ldquo;as is&rdquo;. To the extent the law allows, we disclaim implied
          warranties, and our total liability to you for any claim related to Sifty is limited to
          the amount you paid us in the twelve months before the claim. We are not liable for
          indirect or consequential losses, including lost data or missed deadlines. Nothing here
          limits liability that cannot be limited by law.
        </p>
      </Section>

      <Section id="law" title="Governing law">
        <p>
          These terms are governed by the laws of the State of Delaware, United States, and disputes
          will be resolved in its courts, unless the law where you live gives you other rights.
          <span className="block mt-2 text-[13px] text-[var(--fg-subtle)]">
            [Review note: confirm governing law matches {LEGAL_ENTITY}&rsquo;s state of
            incorporation.]
          </span>
        </p>
      </Section>

      <Section id="changes" title="Changes to these terms">
        <p>
          We may update these terms. The date at the top shows the current version. For material
          changes we will notify you by email or in the app before they take effect; continuing to
          use Sifty after that means you accept them.
        </p>
      </Section>
    </LegalPage>
  );
}
