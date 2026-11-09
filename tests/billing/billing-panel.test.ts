// @vitest-environment jsdom
import { BillingPanel } from "@/components/billing/billing-panel";
import type { Entitlement } from "@/lib/domain/types";
import { capsForTier } from "@/lib/entitlements/entitlements";
import { screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../helpers/intl";

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

function renderPanel(
  props: Partial<Parameters<typeof BillingPanel>[0]>,
  locale: "en" | "es" = "en",
) {
  return renderWithIntl(
    createElement(BillingPanel, {
      user,
      entitlement: ent("free"),
      hasSubscription: false,
      subscriptionActive: false,
      ...props,
    }),
    { locale },
  );
}

describe("BillingPanel", () => {
  it("free: shows the free cap and both upgrade buttons", () => {
    renderPanel({ entitlement: ent("free", { siftsToday: 2 }) });
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText(/3 of 5 free sifts left today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upgrade — Monthly/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upgrade — Yearly/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Manage subscription/ })).toBeNull();
  });

  it("pro: no upgrade buttons, portal available", () => {
    renderPanel({ entitlement: ent("pro"), hasSubscription: true, subscriptionActive: true });
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("comped while Stripe still bills: no second checkout, portal available", () => {
    renderPanel({ entitlement: ent("comped"), hasSubscription: true, subscriptionActive: true });
    expect(screen.getByText(/Pro via invite code/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Manage subscription/ })).toBeInTheDocument();
  });

  it("comped without a subscription: upgrade stays available for after the comp", () => {
    renderPanel({
      entitlement: ent("comped", { compedUntil: new Date(Date.now() + 864e5).toISOString() }),
    });
    expect(screen.getByRole("button", { name: /Upgrade — Monthly/ })).toBeInTheDocument();
  });

  it("creator: no billing section at all", () => {
    renderPanel({ user: { ...user, isCreator: true }, entitlement: ent("creator") });
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upgrade/ })).toBeNull();
    expect(screen.getByText(/Stripe never bills this account/)).toBeInTheDocument();
  });

  it("speaks Spanish: tier, sift count, upgrade buttons", () => {
    renderPanel({ entitlement: ent("free", { siftsToday: 2 }) }, "es");
    expect(screen.getByText("Gratis")).toBeInTheDocument();
    expect(screen.getByText(/Te quedan 3 de 5 clasificaciones gratis hoy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pasar a Pro — Mensual/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Canjear/ })).toBeInTheDocument();
  });

  it("pluralizes the Spanish trial countdown", () => {
    renderPanel(
      {
        entitlement: ent("trialing", {
          trialEndsAt: new Date(Date.now() + 3 * 864e5 - 60_000).toISOString(),
        }),
      },
      "es",
    );
    expect(screen.getByText("Quedan 3 días de tu prueba de Pro.")).toBeInTheDocument();
  });
});
