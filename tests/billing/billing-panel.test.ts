// @vitest-environment jsdom
import { BillingPanel, type StripeFacts } from "@/components/billing/billing-panel";
import type { Entitlement } from "@/lib/domain/types";
import { capsForTier } from "@/lib/entitlements/entitlements";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function ent(tier: Entitlement["tier"], extra: Partial<Entitlement> = {}): Entitlement {
  return {
    tier,
    trialEndsAt: null,
    compedUntil: null,
    siftsToday: 0,
    caps: capsForTier(tier),
    ...extra,
  };
}

const user = { email: "u@example.com", isCreator: false };

const noStripe: StripeFacts = {
  customer: false,
  open: false,
  active: false,
  status: null,
  currentPeriodEnd: null,
};
const paying: StripeFacts = {
  customer: true,
  open: true,
  active: true,
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 20 * 864e5).toISOString(),
};
const dunning: StripeFacts = { ...paying, active: false, status: "past_due" };

function renderPanel(props: Partial<Parameters<typeof BillingPanel>[0]>) {
  return render(
    createElement(BillingPanel, {
      user,
      entitlement: ent("free"),
      billingConfigured: true,
      stripe: noStripe,
      paymentProblem: null,
      ...props,
    }),
  );
}

describe("BillingPanel", () => {
  it("free: shows the free cap and both upgrade buttons priced from the plan catalog", () => {
    renderPanel({ entitlement: ent("free", { siftsToday: 2 }) });
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText(/3 of 5 free sifts left today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upgrade — \$10\/month/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Upgrade — \$96\/year\s*save 20%/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manage subscription/ })).toBeNull();
  });

  it("without Stripe configured: no upgrade buttons, a plain explanation, invite codes still offered", () => {
    renderPanel({ billingConfigured: false });
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByTestId("billing-not-configured")).toHaveTextContent(/isn't set up yet/);
    expect(screen.getByText(/Redeem it here/)).toBeInTheDocument();
  });

  it("pro: no upgrade buttons, portal available", () => {
    renderPanel({ entitlement: ent("pro"), stripe: paying });
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("pro on a Stripe trial: says when the first charge lands", () => {
    renderPanel({
      entitlement: ent("pro"),
      stripe: { ...paying, status: "trialing", currentPeriodEnd: "2026-11-01T12:00:00.000Z" },
    });
    expect(screen.getByText(/first charge is on November 1/)).toBeInTheDocument();
  });

  it("comped while Stripe still bills: no second checkout, portal available", () => {
    renderPanel({ entitlement: ent("comped"), stripe: paying });
    expect(screen.getByText(/Pro via invite code/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("comped without a subscription: upgrade stays available for after the comp", () => {
    renderPanel({
      entitlement: ent("comped", { compedUntil: new Date(Date.now() + 864e5).toISOString() }),
    });
    expect(screen.getByRole("button", { name: /Upgrade — \$10\/month/ })).toBeInTheDocument();
  });

  it("in dunning grace: payment-needed card with portal button, no new checkout", () => {
    renderPanel({
      entitlement: ent("pro"),
      stripe: dunning,
      paymentProblem: { kind: "grace", graceEndsAt: "2026-10-19T12:00:00.000Z" },
    });
    const card = screen.getByTestId("billing-payment-problem");
    expect(card).toHaveTextContent(/Pro stays on until October 19/);
    expect(screen.getByText("Sifty Pro — payment needed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Update payment method/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
  });

  it("lapsed after grace: dropped to free, still no second checkout, portal is the way back", () => {
    renderPanel({ entitlement: ent("free"), stripe: dunning, paymentProblem: { kind: "lapsed" } });
    expect(screen.getByTestId("billing-payment-problem")).toHaveTextContent(/Pro is paused/);
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("cancelled subscription: upgrade reopens, portal stays for invoices", () => {
    renderPanel({
      entitlement: ent("free"),
      stripe: { ...paying, open: false, active: false, status: "canceled" },
    });
    expect(screen.getByRole("button", { name: /Upgrade — \$10\/month/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manage subscription/ })).toBeNull();
  });

  it("creator: no billing section at all", () => {
    renderPanel({ user: { ...user, isCreator: true }, entitlement: ent("creator") });
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByText(/Stripe never bills this account/)).toBeInTheDocument();
  });
});
