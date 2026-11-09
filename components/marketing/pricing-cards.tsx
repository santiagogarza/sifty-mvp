import { buttonVariants } from "@/components/ui/button-variants";
import {
  FREE_SIFTS_PER_DAY,
  PLANS,
  PRO_PRICES,
  PRO_TRIAL_DAYS,
  formatPrice,
  yearlySavingsPercent,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

export function PricingCards() {
  const t = useTranslations("marketing.plans");
  const tier = useTranslations("common.tiers.label");
  const marketing = useTranslations("marketing");
  const rollingOut = marketing("rollingOut");
  return (
    <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
      <PlanCard
        id="free"
        name={tier("free")}
        tagline={t("free.tagline")}
        price={<Price amount="$0" period={t("forever")} />}
        features={PLANS.free.features.map((f) => ({
          key: f.id,
          label: t(`free.features.${f.id}`, { count: FREE_SIFTS_PER_DAY }),
          rollingOut: f.status === "rolling-out",
        }))}
        rollingOutLabel={rollingOut}
        cta={
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
          >
            {t("startFree")}
          </Link>
        }
        footnote={t("free.footnote", { count: FREE_SIFTS_PER_DAY })}
      />
      <PlanCard
        highlighted
        id="pro"
        name={tier("pro")}
        tagline={t("pro.tagline")}
        price={
          <Price
            amount={formatPrice(PRO_PRICES.monthly)}
            period={t("perMonth")}
            secondary={t("yearly", {
              price: formatPrice(PRO_PRICES.yearly),
              percent: String(yearlySavingsPercent()),
            })}
          />
        }
        features={PLANS.pro.features.map((f) => ({
          key: f.id,
          label: t(`pro.features.${f.id}`),
          rollingOut: f.status === "rolling-out",
        }))}
        rollingOutLabel={rollingOut}
        cta={
          <Link
            href="/sign-up"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
          >
            {t("startTrial", { days: PRO_TRIAL_DAYS })}
          </Link>
        }
        footnote={t("pro.footnote")}
      />
    </div>
  );
}

function PlanCard({
  id,
  name,
  tagline,
  price,
  features,
  rollingOutLabel,
  cta,
  footnote,
  highlighted,
}: {
  id: string;
  name: string;
  tagline: string;
  price: React.ReactNode;
  features: Array<{ key: string; label: string; rollingOut: boolean }>;
  rollingOutLabel: string;
  cta: React.ReactNode;
  footnote: string;
  highlighted?: boolean;
}) {
  return (
    <section
      aria-labelledby={`plan-${id}`}
      className={cn(
        "surface-card p-6 sm:p-7 flex flex-col gap-5",
        highlighted && "border-[var(--accent)]/40 shadow-[0_0_0_1px_var(--accent-soft)]",
      )}
    >
      <div>
        <h2 id={`plan-${id}`} className="text-[20px] text-[var(--fg)]">
          {name}
        </h2>
        <p className="mt-1 text-[14px] text-[var(--fg-muted)]">{tagline}</p>
      </div>
      {price}
      {cta}
      <ul className="flex flex-col gap-2.5">
        {features.map((f) => (
          <li key={f.key} className="flex gap-2.5 text-[14px] leading-[1.5] text-[var(--fg)]">
            <Check size={16} className="mt-[3px] shrink-0 text-[var(--done)]" aria-hidden="true" />
            <span>
              {f.label}
              {f.rollingOut ? (
                <span className="ml-2 whitespace-nowrap rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ai)] align-middle">
                  {rollingOutLabel}
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
