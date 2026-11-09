"use client";

import { RedeemInviteForm } from "@/components/billing/redeem-invite-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Entitlement } from "@/lib/domain/types";
import { FREE_SIFTS_PER_DAY } from "@/lib/entitlements/entitlements";
import { useTierCopy } from "@/lib/i18n/use-tier-copy";
import { useTranslations } from "next-intl";
import * as React from "react";

type Translate = ReturnType<typeof useTranslations<"account.billing">>;

export function BillingPanel({
  user,
  entitlement,
  hasSubscription,
  subscriptionActive,
}: {
  user: { email: string; isCreator: boolean };
  entitlement: Entitlement;
  /** A Stripe subscription exists (active or not), so the portal is useful. */
  hasSubscription: boolean;
  /** Stripe is billing now. A comp can mask this as `comped`, so check it directly. */
  subscriptionActive: boolean;
}) {
  const t = useTranslations("account.billing");
  const tierCopy = useTierCopy();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function startCheckout(cadence: "monthly" | "yearly") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cadence }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(
          data.code === "rate_limited"
            ? t("errors.rateLimited")
            : res.status === 409
              ? t("errors.alreadySubscribed")
              : res.status === 503
                ? t("errors.checkoutUnavailable")
                : t("errors.checkoutFailed"),
        );
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.checkoutFailed"));
      setPending(false);
    }
  }

  async function openPortal() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(
          data.code === "rate_limited"
            ? t("errors.rateLimited")
            : res.status === 400
              ? t("errors.noCustomer")
              : t("errors.portalFailed"),
        );
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.portalFailed"));
      setPending(false);
    }
  }

  const { tier } = entitlement;
  const isPro = tier === "pro";
  // Never offer a second subscription to someone Stripe is already billing.
  const canCheckout = !isPro && !subscriptionActive;
  const paidTier = tier === "pro" || tier === "comped" || tier === "creator";
  const trialDaysLeft = entitlement.trialEndsAt ? daysUntil(entitlement.trialEndsAt) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="surface-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] text-[var(--fg)]">{user.email}</div>
            <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
              {tierCopy.summary(entitlement)}
            </div>
          </div>
          <Badge tone={paidTier ? "ember" : "mist"}>{tierCopy.label(tier)}</Badge>
        </div>
        <div className="text-[13px] text-[var(--fg-muted)] mt-3">{statusLine(t, entitlement)}</div>
        {tier === "trialing" && trialDaysLeft !== null ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-1">
            {trialDaysLeft === 0
              ? t("trialEndsToday")
              : t("trialDaysLeft", { count: trialDaysLeft })}
          </div>
        ) : null}
        {tier === "creator" ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-1">{t("creatorNote")}</div>
        ) : null}
      </section>

      {!user.isCreator ? (
        <section className="surface-card p-5">
          <div className="text-eyebrow mb-2">{isPro ? t("subscription") : "Sifty Pro"}</div>
          <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] max-w-prose">
            {upgradeCopy(t, entitlement)}
          </p>
          {canCheckout ? (
            <div className="flex gap-2 mt-4">
              <Button variant="primary" disabled={pending} onClick={() => startCheckout("monthly")}>
                {t("upgradeMonthly")}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => startCheckout("yearly")}>
                {t("upgradeYearly")}
              </Button>
            </div>
          ) : null}
          {hasSubscription ? (
            <Button variant="ghost" disabled={pending} onClick={openPortal} className="mt-3">
              {t("manage")}
            </Button>
          ) : null}
          {error ? (
            <div role="alert" className="text-[13px] text-[var(--warn)] mt-3">
              {error}
            </div>
          ) : null}
        </section>
      ) : null}

      {!user.isCreator ? (
        <section className="surface-card p-5">
          <div className="text-eyebrow mb-2">{t("inviteTitle")}</div>
          <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] max-w-prose mb-4">
            {tier === "comped" ? t("inviteComped") : t("inviteDefault")}
          </p>
          <div className="max-w-md">
            <RedeemInviteForm />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / (1000 * 60 * 60 * 24)));
}

function statusLine(t: Translate, ent: Entitlement): string {
  const cap = ent.caps.siftsPerDay;
  if (!Number.isFinite(cap)) return t("usage.unlimited", { count: ent.siftsToday });
  if (ent.tier === "free") {
    const left = Math.max(0, cap - ent.siftsToday);
    return left === 0 ? t("usage.freeExhausted", { cap }) : t("usage.freeLeft", { left, cap });
  }
  return t("usage.fairUse", { count: ent.siftsToday, cap });
}

function upgradeCopy(t: Translate, ent: Entitlement): string {
  switch (ent.tier) {
    case "pro":
      return t("upgrade.pro");
    case "comped":
      return ent.compedUntil ? t("upgrade.compedUntil") : t("upgrade.compedForever");
    case "trialing":
      return t("upgrade.trialing");
    default:
      return t("upgrade.free", { count: FREE_SIFTS_PER_DAY });
  }
}
