"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import * as React from "react";

export function BillingPanel({
  user,
  entitlement,
}: {
  user: { email: string; isCreator: boolean };
  entitlement: EntitlementSnapshot | null;
}) {
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

  const tier = user.isCreator ? "creator" : (entitlement?.tier ?? "trialing");
  const trialEnds = entitlement?.trialEndsAt ? new Date(entitlement.trialEndsAt) : null;
  const trialingDaysLeft = trialEnds
    ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="surface-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[15px] text-[var(--fg)]">{user.email}</div>
            <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">{tierLabel(tier)}</div>
          </div>
          <Badge tone={tier === "active" || tier === "creator" ? "ember" : "mist"}>
            {tier === "active" ? "Pro" : tier === "creator" ? "Creator" : tier}
          </Badge>
        </div>
        {tier === "trialing" && trialingDaysLeft !== null ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-3">
            {trialingDaysLeft === 0
              ? "Trial ends today."
              : `${trialingDaysLeft} day${trialingDaysLeft === 1 ? "" : "s"} left in your trial.`}
          </div>
        ) : null}
        {tier === "expired" ? (
          <div className="text-[13px] text-[var(--warn)] mt-3">
            Trial has ended. Upgrade to keep using AI triage.
          </div>
        ) : null}
        {tier === "creator" ? (
          <div className="text-[13px] text-[var(--fg-muted)] mt-3">
            Permanent unlimited access — Stripe never bills this account.
          </div>
        ) : null}
      </section>

      {!user.isCreator ? (
        <section className="surface-card p-5">
          <div className="text-eyebrow mb-2">Upgrade</div>
          <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] max-w-prose">
            Sifty Pro unlocks the daily AI cap and higher-quality models. Pause or cancel anytime.
            Promo codes redeemable at checkout.
          </p>
          <div className="flex gap-2 mt-4">
            <Button
              variant="primary"
              disabled={pending || tier === "active"}
              onClick={() => startCheckout("monthly")}
            >
              {tier === "active" ? "On Pro monthly" : "Upgrade — Monthly"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending || tier === "active"}
              onClick={() => startCheckout("yearly")}
            >
              {tier === "active" ? "On Pro yearly" : "Upgrade — Yearly"}
            </Button>
          </div>
          {tier === "active" ? (
            <Button variant="ghost" disabled={pending} onClick={openPortal} className="mt-3">
              Manage subscription
            </Button>
          ) : null}
          {error ? (
            <div role="alert" className="text-[13px] text-[var(--warn)] mt-3">
              {error}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function tierLabel(tier: string): string {
  switch (tier) {
    case "creator":
      return "Creator — unlimited";
    case "active":
      return "Pro — active subscription";
    case "trialing":
      return "Free trial";
    case "expired":
      return "Trial expired";
    default:
      return tier;
  }
}
