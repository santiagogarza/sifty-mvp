"use client";

import { PageHeader } from "@/components/app-shell/page-header";
import { PageShell } from "@/components/app-shell/page-shell";
import { useTheme } from "@/components/app-shell/theme-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_MODEL_PREFERENCE,
  MODELS,
  MODEL_PREFERENCES,
  type ModelPreferenceOption,
  type StageRoute,
  getModelPreference,
} from "@/lib/ai/models";
import { authClient } from "@/lib/auth/client";
import type { Entitlement, Tier } from "@/lib/domain/types";
import { tierLabel, tierSummary } from "@/lib/entitlements/entitlements";
import { useStore } from "@/lib/store/store";
import { resetLocalWorkspace } from "@/lib/store/sync";
import { cn } from "@/lib/utils/cn";
import { Check, Cpu, CreditCard, Download, LogOut, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { SessionsPanel } from "./sessions-panel";

export interface SettingsAccount {
  email: string;
  displayName: string;
  entitlement: Entitlement;
  /** True when running with SIFTY_DISABLE_AUTH — sign-out is meaningless. */
  authBypass: boolean;
}

export function SettingsClient({ account }: { account: SettingsAccount }) {
  const { theme, setTheme } = useTheme();
  const modelPreference = useStore((s) => s.modelPreference);
  const setModelPreference = useStore((s) => s.setModelPreference);
  const hydrated = useStore((s) => s.hydrated);
  const activePreferenceId = hydrated ? modelPreference : DEFAULT_MODEL_PREFERENCE;
  const activePreference = getModelPreference(activePreferenceId);
  const [signingOut, setSigningOut] = React.useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
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
              <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
                {tierSummary(account.entitlement)}
              </div>
            </div>
            <Badge tone={tierBadgeTone(account.entitlement.tier)}>
              {tierLabel(account.entitlement.tier)}
            </Badge>
          </div>
          <div className="text-[12px] text-[var(--fg-muted)] mt-2">
            {siftsLine(account.entitlement)}
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

      {account.authBypass ? null : (
        <SectionCard
          title="Sessions"
          description="Every device signed in to this account. Signing out elsewhere takes effect immediately."
        >
          <SessionsPanel />
        </SectionCard>
      )}

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
        description="Pick the trade-off between speed and depth. Each choice sets a primary model and a fallback from another provider, so an outage never stalls your list. Edits you make are protected from being overwritten."
      >
        <div className="grid sm:grid-cols-2 gap-2 max-w-2xl">
          {MODEL_PREFERENCES.map((p) => {
            const active = p.id === activePreferenceId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setModelPreference(p.id)}
                aria-pressed={active}
                data-testid={`model-option-${p.id}`}
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
                    <div className="text-[13.5px] text-[var(--fg)]">{p.label}</div>
                  </div>
                  <Badge tone={primaryProvider(p) === "anthropic" ? "ember" : "mist"}>
                    {primaryProvider(p)}
                  </Badge>
                </div>
                <div className="text-[12px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
                  {p.description}
                </div>
                <div className="text-[11px] text-[var(--fg-subtle)] mt-1">
                  Sift: {routeLine(p.routes.fast)} · Plan: {routeLine(p.routes.deep)}
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="AI behavior"
        description="Provider keys and the transport (AI Gateway or direct) are set in the server environment. Sifty never asks for a key in the browser."
      >
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Stat label="Prompt version" value="triage.v1" />
          <Stat label="Triage model" value={MODELS[activePreference.routes.fast.primary].label} />
          <Stat label="Min visible delay" value="450 ms" />
          <Stat label="Edited fields protected" value="Yes" />
        </div>
      </SectionCard>

      <SectionCard
        title="Data"
        description="Tasks, labels, and memories sync to your account. This browser also keeps a local cache for instant loads — resetting it does not delete synced data."
      >
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/account/export"
            download
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Download size={14} />
            Export your data
          </a>
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
        </div>
        <p className="mt-2 text-[12px] text-[var(--fg-subtle)] max-w-prose">
          The export is a JSON file with your tasks, labels, memories, task history, and AI runs.
        </p>
      </SectionCard>

      {account.authBypass ? null : (
        <SectionCard
          title="Delete account"
          description="Permanently deletes your account, every task, label, memory, and AI run, and cancels any subscription. There is no undo — export first if you want a copy."
        >
          <DeleteAccount email={account.email} />
        </SectionCard>
      )}
    </PageShell>
  );
}

function primaryProvider(p: ModelPreferenceOption): string {
  return MODELS[p.routes.fast.primary].provider;
}

/** "Claude Haiku 4.5 → GPT-5 mini" */
function routeLine(route: StageRoute): string {
  return [route.primary, ...route.fallbacks].map((slug) => MODELS[slug].label).join(" → ");
}

function DeleteAccount({ email }: { email: string }) {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  };

  const confirmDelete = async () => {
    if (!matches || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't delete the account.");
      }
      // The server already dropped the session; clear this browser's copy
      // of the workspace so nothing of it lingers for the next sign-in.
      resetLocalWorkspace();
      window.localStorage.removeItem("sifty-store-v1");
      window.location.href = "/sign-in?deleted=1";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the account.");
      setPending(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => reset(true)}
        className="border-[var(--warn)]/40 text-[var(--warn)] hover:bg-[var(--warn)]/10"
      >
        <Trash2 size={14} />
        Delete account…
      </Button>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent placement="center" className="w-[min(480px,calc(100vw-32px))]">
          <div className="px-5 pt-5 pb-2">
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-[1.5]">
              This removes everything in Sifty for <span className="text-[var(--fg)]">{email}</span>{" "}
              and cancels any subscription. It cannot be undone.
            </DialogDescription>
          </div>
          <div className="px-5 pb-4">
            <label htmlFor="delete-account-confirm" className="text-eyebrow mb-1.5 block">
              Type your email to confirm
            </label>
            <Input
              id="delete-account-confirm"
              autoComplete="off"
              spellCheck={false}
              placeholder={email}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmDelete();
                }
              }}
            />
            {error ? (
              <p role="alert" className="mt-2 text-[12.5px] text-[var(--warn)]">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3 bg-[var(--surface-muted)]">
            <Button variant="ghost" onClick={() => reset(false)} disabled={pending}>
              Keep account
            </Button>
            <Button
              variant="primary"
              onClick={confirmDelete}
              disabled={!matches || pending}
              className="bg-[var(--warn)] text-white"
            >
              {pending ? "Deleting…" : "Delete everything"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function accountDescription(account: SettingsAccount): string {
  if (account.authBypass) {
    return "Running with SIFTY_DISABLE_AUTH=1 — sign-in is bypassed for local development.";
  }
  return "Capture, organize, and sync are free for everyone. Sifting with AI is where plans differ.";
}

function tierBadgeTone(tier: Tier): "ember" | "mist" | "sage" | "neutral" {
  return {
    creator: "ember" as const,
    comped: "sage" as const,
    pro: "sage" as const,
    trialing: "mist" as const,
    free: "neutral" as const,
  }[tier];
}

function siftsLine(ent: Entitlement): string {
  if (!Number.isFinite(ent.caps.siftsPerDay)) return `${ent.siftsToday} sifts today — unlimited`;
  if (ent.tier === "free") {
    return `${ent.siftsToday} of ${ent.caps.siftsPerDay} free sifts used today`;
  }
  return `${ent.siftsToday} sifts today — unlimited, fair-use cap ${ent.caps.siftsPerDay}/day`;
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
