import { buttonVariants } from "@/components/ui/button-variants";
import {
  FREE_SIFTS_PER_DAY,
  PLANS,
  PRO_PRICES,
  PRO_TRIAL_DAYS,
  type PlanFeature,
  formatPrice,
  yearlySavingsPercent,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import Link from "next/link";

export function PricingCards() {
  const free = PLANS.free;
  const pro = PLANS.pro;
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
      <PlanCard
        name={free.name}
        tagline={free.tagline}
        price={<Price amount="$0" period="forever" />}
        features={free.features}
        cta={
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
          >
            Start free
          </Link>
        }
        footnote={`${FREE_SIFTS_PER_DAY} sifts a day. Everything you capture is always yours.`}
      />
      <PlanCard
        highlighted
        name={pro.name}
        tagline={pro.tagline}
        price={
          <Price
            amount={formatPrice(PRO_PRICES.monthly)}
            period="per month"
            secondary={`or ${formatPrice(PRO_PRICES.yearly)} a year (save ${yearlySavingsPercent()}%)`}
          />
        }
        features={pro.features}
        cta={
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
          >
            Start {PRO_TRIAL_DAYS}-day Pro trial
          </Link>
        }
        footnote="No card for the trial. After it ends you drop to Free unless you choose to pay. Cancel anytime."
      />
    </div>
  );
}

function PlanCard({
  name,
  tagline,
  price,
  features,
  cta,
  footnote,
  highlighted,
}: {
  name: string;
  tagline: string;
  price: React.ReactNode;
  features: PlanFeature[];
  cta: React.ReactNode;
  footnote: string;
  highlighted?: boolean;
}) {
  return (
    <section
      aria-labelledby={`plan-${name.toLowerCase()}`}
      className={cn(
        "surface-card p-6 sm:p-7 flex flex-col gap-5",
        highlighted && "border-[var(--accent)]/40 shadow-[0_0_0_1px_var(--accent-soft)]",
      )}
    >
      <div>
        <h2 id={`plan-${name.toLowerCase()}`} className="text-[20px] text-[var(--fg)]">
          {name}
        </h2>
        <p className="mt-1 text-[14px] text-[var(--fg-muted)]">{tagline}</p>
      </div>
      {price}
      {cta}
      <ul className="flex flex-col gap-2.5">
        {features.map((f) => (
          <li key={f.label} className="flex gap-2.5 text-[14px] leading-[1.5] text-[var(--fg)]">
            <Check size={16} className="mt-[3px] shrink-0 text-[var(--done)]" aria-hidden="true" />
            <span>
              {f.label}
              {f.status === "rolling-out" ? (
                <span className="ml-2 rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ai)] align-middle">
                  rolling out
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-auto text-[12.5px] leading-[1.5] text-[var(--fg-subtle)]">{footnote}</p>
    </section>
  );
}

function Price({
  amount,
  period,
  secondary,
}: {
  amount: string;
  period: string;
  secondary?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-display text-num text-[40px] text-[var(--fg)]">{amount}</span>
        <span className="text-[14px] text-[var(--fg-muted)]">{period}</span>
      </div>
      {secondary ? (
        <div className="mt-1 text-[13px] text-[var(--fg-muted)]">{secondary}</div>
      ) : null}
    </div>
  );
}
