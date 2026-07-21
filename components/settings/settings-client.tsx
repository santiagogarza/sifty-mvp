"use client";

import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { useTheme } from "@/components/app-shell/theme-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from "@/lib/ai/models";
import { useStore } from "@/lib/store/store";
import { resetLocalWorkspace } from "@/lib/store/sync";
import { cn } from "@/lib/utils/cn";
import { Check, Cpu, CreditCard, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import * as React from "react";

export interface SettingsAccount {
  email: string;
  displayName: string;
  tier: "creator" | "trialing" | "active" | "expired";
  trialEndsAt: string | null;
  /** True when running with SIFTY_DISABLE_AUTH — sign-out is meaningless. */
  authBypass: boolean;
}

export function SettingsClient({ account }: { account: SettingsAccount }) {
  const { theme, setTheme } = useTheme();
  const preferredModelId = useStore((s) => s.preferredModelId);
  const setPreferredModelId = useStore((s) => s.setPreferredModelId);
  const hydrated = useStore((s) => s.hydrated);
  const activeModelId = hydrated ? preferredModelId : DEFAULT_MODEL_ID;
  const activeModel = MODEL_OPTIONS.find((m) => m.id === activeModelId) ?? MODEL_OPTIONS[0]!;
  const [signingOut, setSigningOut] = React.useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
    } finally {
      // Clear the local cache so the next account on this browser starts
      // clean instead of inheriting this workspace.
      resetLocalWorkspace();
      window.location.href = "/sign-in";
    }
  };

  return (
    <PageShell title="Settings">
      <PageHeader
        title="Settings"
        description="A small set of controls. The rest of Sifty stays out of your way."
      />

      <SectionCard title="Account" description={accountDescription(account)}>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13.5px] text-[var(--fg)] truncate">{account.email}</div>
              <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">{tierLine(account)}</div>
            </div>
            <Badge tone={account.tier === "creator" ? "ember" : tierBadgeTone(account.tier)}>
              {tierLabel(account.tier)}
            </Badge>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] transition-colors"
            >
              <CreditCard size={13} />
              Billing
            </Link>
            {account.authBypass ? null : (
              <Button variant="ghost" size="sm" onClick={signOut} disabled={signingOut}>
                <LogOut size={13} />
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Appearance"
        description="Sifty looks best in the dark, but it's your call."
      >
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {(
            [
              { key: "system", label: "System", icon: Monitor },
              { key: "light", label: "Light", icon: Sun },
              { key: "dark", label: "Dark", icon: Moon },
            ] as const
          ).map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTheme(opt.key)}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3 py-3",
                  "flex flex-col items-start gap-2 text-left transition-colors",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <Icon
                  size={16}
                  className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
                />
                <span className="flex items-center gap-1.5 text-[13.5px] text-[var(--fg)]">
                  {opt.label}
                  {active ? <Check size={12} className="text-[var(--accent)]" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="AI model"
        description="Triage runs through the AI Gateway. Pick a model that matches your trade-off between speed and depth. Edits you make are protected from being overwritten."
      >
        <div className="grid sm:grid-cols-2 gap-2 max-w-2xl">
          {MODEL_OPTIONS.map((m) => {
            const active = m.id === activeModelId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPreferredModelId(m.id)}
                aria-pressed={active}
                data-testid={`model-option-${m.id}`}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-colors",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu
                      size={14}
                      className={active ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"}
                    />
                    <div className="text-[13.5px] text-[var(--fg)]">{m.label}</div>
                  </div>
                  <Badge tone={m.provider === "anthropic" ? "ember" : "mist"}>{m.provider}</Badge>
                </div>
                <div className="text-[12px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
                  {m.description}
                </div>
                <div className="text-[11px] text-[var(--fg-subtle)] mt-1">{m.gatewaySlug}</div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="AI behavior"
        description="Provider keys come from the server environment (AI_GATEWAY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY). Sifty never asks for a key in the browser."
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Stat label="Prompt version" value="triage.v1" />
          <Stat label="Active model" value={activeModel.label} />
          <Stat label="Min visible delay" value="450 ms" />
          <Stat label="Edited fields protected" value="Yes" />
        </div>
      </SectionCard>

      <SectionCard
        title="Data"
        description="Tasks, labels, and memories sync to your account. This browser also keeps a local cache for instant loads — resetting it does not delete synced data."
      >
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm("Reset this browser's local Sifty cache? Synced data is unaffected.")) {
              window.localStorage.removeItem("sifty-store-v1");
              window.localStorage.removeItem("sifty-sync-ledger-v1");
              window.location.reload();
            }
          }}
        >
          Reset local cache
        </Button>
      </SectionCard>
    </PageShell>
  );
}

function accountDescription(account: SettingsAccount): string {
  if (account.authBypass) {
    return "Running with SIFTY_DISABLE_AUTH=1 — sign-in is bypassed for local development.";
  }
  return "The creator account is permanently free; everyone else gets a 30-day trial.";
}

function tierLabel(tier: SettingsAccount["tier"]): string {
  return { creator: "Creator", trialing: "Trial", active: "Pro", expired: "Expired" }[tier];
}

function tierBadgeTone(tier: SettingsAccount["tier"]): "mist" | "sage" | "neutral" {
  return {
    creator: "neutral" as const,
    trialing: "mist" as const,
    active: "sage" as const,
    expired: "neutral" as const,
  }[tier];
}

function tierLine(account: SettingsAccount): string {
  switch (account.tier) {
    case "creator":
      return "Creator — unlimited AI usage";
    case "trialing":
      return account.trialEndsAt
        ? `Trial ends ${new Date(account.trialEndsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}`
        : "Trialing";
    case "active":
      return "Sifty Pro — subscription active";
    case "expired":
      return "Trial ended — upgrade to keep using AI triage";
  }
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="text-eyebrow mb-1.5">{title}</div>
      {description ? (
        <p className="text-[13px] text-[var(--fg-muted)] leading-[1.5] mb-3 max-w-prose">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      <div className="text-eyebrow">{label}</div>
      <div className="text-[13.5px] text-[var(--fg)] mt-0.5">{value}</div>
    </div>
  );
}
