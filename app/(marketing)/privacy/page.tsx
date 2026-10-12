import { LegalPage, Section } from "@/components/marketing/legal-page";
import { LEGAL_ENTITY, PROCESSORS, getSupportEmail } from "@/lib/site/config";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${LEGAL_ENTITY} collects, uses, and protects your data when you use Sifty.`,
  alternates: { canonical: "/privacy" },
};

const UPDATED = "2026-10-12";

export default function PrivacyPage() {
  const support = getSupportEmail();
  return (
    <LegalPage title="Privacy policy" updated={UPDATED}>
      <Section id="who" title="Who we are">
        <p>
          Sifty is operated by {LEGAL_ENTITY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy
          explains what we collect when you use Sifty, why, who processes it on our behalf, and the
          choices you have. Questions go to{" "}
          <a href={`mailto:${support}`} className="underline underline-offset-2">
            {support}
          </a>
          .
        </p>
      </Section>

      <Section id="collect" title="What we collect">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>
            <strong className="text-[var(--fg)] font-medium">Account data:</strong> your email
            address, a display name, and a salted hash of your password. We never store the password
            itself.
          </li>
          <li>
            <strong className="text-[var(--fg)] font-medium">Your content:</strong> the tasks you
            capture, everything Sifty fills in (titles, details, priorities, labels, subtasks,
            reasoning), your edits, and the memories you ask Sifty to keep.
          </li>
          <li>
            <strong className="text-[var(--fg)] font-medium">Usage records:</strong> which AI runs
            happened, when, with which model, and roughly what they cost, so we can enforce plan
            limits and understand costs.
          </li>
          <li>
            <strong className="text-[var(--fg)] font-medium">Billing data:</strong> if you
            subscribe, Stripe handles your card. We store only Stripe&rsquo;s customer and
            subscription identifiers and the status of your subscription.
          </li>
          <li>
            <strong className="text-[var(--fg)] font-medium">Technical data:</strong> request logs
            (IP address, browser, timestamps) and error reports needed to keep the service running.
          </li>
        </ul>
        <p>We do not buy data about you, and we do not run advertising or third-party trackers.</p>
      </Section>

      <Section id="use" title="How we use it">
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>To provide Sifty: store and sync your tasks, sift them with AI, and remind you.</li>
          <li>To run your account: sign you in, bill you if you subscribe, and answer support.</li>
          <li>To keep the service healthy: rate limiting, abuse prevention, and fixing errors.</li>
        </ul>
        <p>
          We do not use your tasks or memories to train AI models, and our AI providers are
          contractually prohibited from doing so with the requests we send.
        </p>
      </Section>

      <Section id="ai" title="AI processing">
        <p>
          When Sifty sifts a task, the text of that task, relevant memories, and your settings are
          sent to an AI model provider through Vercel AI Gateway to produce the result. Only the
          content needed for that task is sent. Sifted output is stored with the task so you can
          review, edit, or discard it.
        </p>
        <p>
          Autonomous execution (where Sifty performs work for you through connected tools) is being
          built. When it launches, it will be off by default, each connection will be opt-in, and
          this policy will be updated before anything runs on your behalf.
        </p>
      </Section>

      <Section id="processors" title="Who processes your data">
        <p>
          We use a small number of service providers. Each only receives what it needs for its
          purpose and is bound by a data-processing agreement.
        </p>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
          <table className="w-full text-[14px]">
            <thead className="bg-[var(--surface-muted)] text-left text-[var(--fg)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Provider
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Purpose
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Location
                </th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 text-[var(--fg)]">{p.name}</td>
                  <td className="px-3 py-2">{p.purpose}</td>
                  <td className="px-3 py-2">{p.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Sifty is hosted in the United States. If you use it from elsewhere, your data is
          transferred to and processed there.
        </p>
      </Section>

      <Section id="cookies" title="Cookies and local storage">
        <p>
          Sifty sets one cookie, <code className="font-mono text-[13px]">sifty_session</code>, to
          keep you signed in. It is strictly necessary, so no consent banner is shown. We use your
          browser&rsquo;s local storage to remember your theme and to keep a copy of your tasks so
          the app works offline. There are no analytics or advertising cookies.
        </p>
      </Section>

      <Section id="retention" title="How long we keep it">
        <p>
          Your content stays as long as your account exists. When you delete a task it is removed
          from your views and purged from our database. Request logs and error reports are kept for
          a short period (currently up to 30 days) and then discarded. If you delete your account we
          remove your data within 30 days, except records we must keep for tax or accounting.
        </p>
      </Section>

      <Section id="rights" title="Your choices and rights">
        <p>
          You can edit or delete any task or memory from inside Sifty. To export your data or delete
          your account, email{" "}
          <a href={`mailto:${support}`} className="underline underline-offset-2">
            {support}
          </a>{" "}
          from your account address and we will do it within 30 days; in-app export and deletion are
          on the way. Depending on where you live you may also have rights to access, correct, port,
          or object to processing of your data. Email us and we will help.
        </p>
      </Section>

      <Section id="security" title="Security">
        <p>
          Data is encrypted in transit and at rest by our hosting and database providers. Passwords
          are hashed with bcrypt. Access to production systems is limited to the people who operate
          Sifty. If you find a vulnerability, see our{" "}
          <Link href="/.well-known/security.txt" className="underline underline-offset-2">
            security.txt
          </Link>{" "}
          for how to report it.
        </p>
      </Section>

      <Section id="children" title="Children">
        <p>
          Sifty is not directed to children under 16 and we do not knowingly collect their data.
        </p>
      </Section>

      <Section id="changes" title="Changes">
        <p>
          When this policy changes in a way that matters, we will update the date at the top and,
          for significant changes, tell you by email or in the app before they take effect.
        </p>
      </Section>
    </LegalPage>
  );
}
