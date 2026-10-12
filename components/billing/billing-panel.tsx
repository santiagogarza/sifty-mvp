"use client";

import { RedeemInviteForm } from "@/components/billing/redeem-invite-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Cadence, PRO_PRICES, formatPrice, yearlySavingsPercent } from "@/lib/billing/plans";
import { honoursRemainingTrial } from "@/lib/billing/trial-carryover";
import type { Entitlement } from "@/lib/domain/types";
import {
  FREE_SIFTS_PER_DAY,
  type PaymentProblem,
  formatBillingDay,
  tierLabel,
  tierSummary,
} from "@/lib/entitlements/entitlements";
import * as React from "react";

export interface StripeFacts {
  /** A Stripe customer exists, so the portal can open. */
  customer: boolean;
  /** Stripe still considers a subscription open (paying, dunning, or incomplete). */
  open: boolean;
  /** Stripe is billing now. A comp can mask this as `comped`, so check it directly. */
  active: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
}

export function BillingPanel({
  user,
  entitlement,
  billingConfigured,
  stripe,
  paymentProblem,
}: {
  user: { email: string; isCreator: boolean };
  entitlement: Entitlement;
  /** Secret key and both price ids are set; otherwise upgrades are hidden. */
  billingConfigured: boolean;
  stripe: StripeFacts;
  paymentProblem: PaymentProblem | null;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function startCheckout(cadence: Cadence) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cadence }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Checkout failed");
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
      setPending(false);
    }
  }

  async function openPortal() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Portal failed");
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal failed");
      setPending(false);
    }
  }

  const { tier } = entitlement;
  const isPro = tier === "pro";
  // Never offer a second subscription to someone Stripe is already billing
  // or chasing for payment.
  const canCheckout = !isPro && !stripe.open;
  const paidTier = tier === "pro" || tier === "comped" || tier === "creator";
  const trialDaysLeft = entitlement.trialEndsAt ? daysUntil(entitlement.trialEndsAt) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="surface-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] text-[var(--fg)]">{user.email}</div>
            <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
              {isPro && paymentProblem ? "Sifty Pro — payment needed" : tierSummary(entitlement)}
            </div>
          </div>
          <Badge tone={paidTier ? "ember" : "mist"}>{tierLabel(tier)}</Badge>
        </div>
        <div className="text-[13px] text-[var(--fg-muted)] mt-3">{statusLine(entitlement)}</div>
        {tier === "trialing" && trialDaysLeft !== null ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-1">
            {trialDaysLeft === 0
              ? "Your Pro trial ends today."
              : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your Pro trial.`}
          </div>
        ) : null}
        {stripe.active && stripe.status === "trialing" && stripe.currentPeriodEnd ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-1">
            Card on file. Your first charge is on {formatBillingDay(stripe.currentPeriodEnd)}.
          </div>
        ) : null}
        {tier === "creator" ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-1">
            Permanent unlimited access — Stripe never bills this account.
          </div>
        ) : null}
      </section>

      {paymentProblem && !user.isCreator ? (
        <section
          role="alert"
          className="surface-card p-5 border-[var(--accent)]"
          data-testid="billing-payment-problem"
        >
          <div className="text-eyebrow mb-2">Payment needed</div>
          <p className="text-[13px] text-[var(--fg)] leading-[1.5] max-w-prose">
            {paymentProblem.kind === "grace"
              ? `Your last payment didn't go through. Pro stays on until ${formatBillingDay(paymentProblem.graceEndsAt)}; update your card before then to keep it.`
              : "Your payment is still failing, so Pro is paused. Update your card to turn it back on; nothing else changes."}
          </p>
          <Button variant="primary" disabled={pending} onClick={openPortal} className="mt-4">
            Update payment method
          </Button>
        </section>
      ) : null}

      {!user.isCreator ? (
        <section className="surface-card p-5">
          <div className="text-eyebrow mb-2">{isPro ? "Subscription" : "Sifty Pro"}</div>
          <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] max-w-prose">
            {upgradeCopy(entitlement)}
          </p>
          {canCheckout && billingConfigured ? (
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="primary" disabled={pending} onClick={() => startCheckout("monthly")}>
                Upgrade — {formatPrice(PRO_PRICES.monthly)}/month
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => startCheckout("yearly")}>
                Upgrade — {formatPrice(PRO_PRICES.yearly)}/year
                <span className="text-[12px] text-[var(--fg-muted)]">
                  save {yearlySavingsPercent()}%
                </span>
              </Button>
            </div>
          ) : null}
          {canCheckout && !billingConfigured ? (
            <p
              className="text-[13px] text-[var(--fg-muted)] mt-4"
              data-testid="billing-not-configured"
            >
              Billing isn't set up yet, so upgrades are closed for now. Invite codes still work.
            </p>
          ) : null}
          {stripe.customer ? (
            <Button variant="ghost" disabled={pending} onClick={openPortal} className="mt-3">
              {stripe.open || isPro ? "Manage subscription" : "Billing history & invoices"}
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
          <div className="text-eyebrow mb-2">Invite code</div>
          <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] max-w-prose mb-4">
            {tier === "comped"
              ? "Have another code? Redeeming it extends your Pro access."
              : "Got an invite from Santi? Redeem it here for Pro without a card."}
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

function statusLine(ent: Entitlement): string {
  if (!Number.isFinite(ent.caps.siftsPerDay)) return `${ent.siftsToday} sifts today.`;
  if (ent.tier === "free") {
    const left = Math.max(0, ent.caps.siftsPerDay - ent.siftsToday);
    return left === 0
      ? `You've used today's ${ent.caps.siftsPerDay} free sifts. Capture keeps working; sifting resumes tomorrow.`
      : `${left} of ${ent.caps.siftsPerDay} free sifts left today.`;
  }
  return `${ent.siftsToday} sifts today. Unlimited sifting, with a fair-use cap of ${ent.caps.siftsPerDay} a day.`;
}

function upgradeCopy(ent: Entitlement): string {
  switch (ent.tier) {
    case "pro":
      return "Unlimited sifting, autonomous execution budget, and connectors. Pause or cancel anytime from the portal.";
    case "comped":
      return ent.compedUntil
        ? "Your invite covers Pro for now. Add a subscription to keep Pro after it ends, or wait until then."
        : "Your invite covers Pro permanently. No card needed.";
    case "trialing":
      return honoursRemainingTrial(ent.trialEndsAt)
        ? "You're on the Pro trial: unlimited sifting. Subscribe now and your card is first charged when the trial ends; or drop to Free and keep capturing with a few sifts a day. Promo codes work at checkout."
        : "Your Pro trial is almost over. Subscribe to keep unlimited sifting (billing starts right away), or drop to Free and keep capturing with a few sifts a day. Promo codes work at checkout.";
    default:
      return `Free includes capture, organize, sync, reminders, and ${FREE_SIFTS_PER_DAY} sifts a day. Pro removes the sifting cap and adds autonomous execution and connectors. Promo codes work at checkout.`;
  }
}
