import { SiftIllustration } from "@/components/marketing/sift-illustration";
import { buttonVariants } from "@/components/ui/button-variants";
import { getSession } from "@/lib/auth/session";
import { FREE_SIFTS_PER_DAY, PRO_TRIAL_DAYS } from "@/lib/billing/plans";
import { cn } from "@/lib/utils/cn";
import { Check, ListChecks, PenLine, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: { absolute: "Sifty — write it down, Sifty does the rest" },
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    icon: PenLine,
    title: "Capture",
    body: "One keystroke, type the thought, move on. No fields, no folders, no decisions at capture time.",
  },
  {
    icon: Sparkles,
    title: "Sift",
    body: "Sifty fills in the details, sets a priority, picks labels and a due date, and breaks the work into steps. Every field is editable, and it explains its reasoning.",
  },
  {
    icon: ListChecks,
    title: "Do",
    body: "Next: Sifty does the work it can — research, drafts, bookings — and leaves you a decision instead of a chore. Nothing is sent without your approval.",
    soon: true,
  },
];

const TODAY = [
  "Capture from anywhere with a keystroke, on phone or laptop",
  "AI sifting: details, priority, labels, due dates, subtasks, and the reasoning behind them",
  "Today, Inbox, Focus, Waiting on, Someday, and Done views",
  "A memory of your preferences that sifting learns from",
  "Sync across devices; edits made offline replay when you are back",
  "A ready-to-paste brief when you want to hand a task to an AI agent",
];

const NEXT = [
  "Reminders by push and email",
  "Autonomous execution: drafts, research, and bookings done for you, waiting for approval",
  "Connectors to your email, calendar, and tools",
];

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect("/today");

  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-5 pt-10 pb-12 sm:px-6 sm:pt-16 sm:pb-16">
        <div className="max-w-2xl animate-rise">
          <div className="text-eyebrow mb-4">Early access</div>
          <h1 className="text-display text-[40px] sm:text-[56px] text-[var(--fg)]">
            Write it down.
            <br />
            Sifty does the rest.
          </h1>
          <p className="mt-5 text-[17px] sm:text-[19px] leading-[1.5] text-[var(--fg-muted)] max-w-xl">
            Capture a task in a second. Sifty fills in the details, decides what matters, breaks the
            work down, and gets most of it done or drafted before you come back. Nothing forgotten,
            and less of it left for you to do.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "sm:min-w-[160px]")}
            >
              Start free
            </Link>
            <Link href="/pricing" className={buttonVariants({ variant: "secondary", size: "lg" })}>
              See pricing
            </Link>
          </div>
          <p className="mt-3 text-[13px] text-[var(--fg-subtle)]">
            {PRO_TRIAL_DAYS}-day Pro trial, no card. The free plan stays free.
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
          Three steps, two of them not yours.
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-muted)] text-[var(--fg-muted)]">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="text-num text-[12px] text-[var(--fg-subtle)]">0{i + 1}</span>
                </div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[17px] text-[var(--fg)]">{step.title}</h3>
                  {step.soon ? (
                    <span className="rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ai)]">
                      rolling out
                    </span>
                  ) : null}
                </div>
                <p className="text-[14px] leading-[1.55] text-[var(--fg-muted)]">{step.body}</p>
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
          Where Sifty is today
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-[1.55] text-[var(--fg-muted)]">
          Sifty is new and built by a tiny team. Here is exactly what works now and what is being
          built next, so you can decide with your eyes open.
        </p>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-eyebrow mb-3">Works today</div>
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
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-eyebrow mb-3">Coming next</div>
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
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13px] leading-[1.5] text-[var(--fg-subtle)]">
              Free includes {FREE_SIFTS_PER_DAY} sifts a day forever. Pro removes the cap and, as
              autonomous execution rolls out, includes a monthly budget for it.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 sm:py-20">
        <div className="surface-card p-7 sm:p-10 text-center">
          <h2 className="text-display text-[28px] sm:text-[34px] text-[var(--fg)]">
            Try it on your real list.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-[1.55] text-[var(--fg-muted)]">
            Paste in the five things rattling around your head. See what Sifty makes of them before
            you decide anything.
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/sign-up"
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "min-w-[160px]")}
            >
              Start free
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
