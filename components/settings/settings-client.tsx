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
import { useTierCopy } from "@/lib/i18n/use-tier-copy";
import { useStore } from "@/lib/store/store";
import { resetLocalWorkspace } from "@/lib/store/sync";
import { cn } from "@/lib/utils/cn";
import {
  Activity,
  Bell,
  Check,
  Cpu,
  CreditCard,
  Download,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import * as React from "react";
import { LanguagePicker } from "./language-picker";
import { SessionsPanel } from "./sessions-panel";

export interface SettingsAccount {
  email: string;
  displayName: string;
  entitlement: Entitlement;
  /** True when running with SIFTY_DISABLE_AUTH — sign-out is meaningless. */
  authBypass: boolean;
}

export function SettingsClient({ account }: { account: SettingsAccount }) {
  const t = useTranslations("settings");
  const tier = useTierCopy();
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
    <PageShell title={t("title")}>
      <PageHeader title={t("title")} description={t("description")} />

      <SectionCard
        title={t("account.title")}
        description={account.authBypass ? t("account.descriptionBypass") : t("account.description")}
      >
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13.5px] text-[var(--fg)] truncate">{account.email}</div>
              <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
                {tier.summary(account.entitlement)}
              </div>
            </div>
            <Badge tone={tierBadgeTone(account.entitlement.tier)}>
              {tier.label(account.entitlement.tier)}
            </Badge>
          </div>
          <div className="text-[12px] text-[var(--fg-muted)] mt-2">
            {siftsLine(account.entitlement, t)}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] transition-colors"
            >
              <CreditCard size={13} />
              {t("account.billing")}
            </Link>
            <Link
              href="/settings/notifications"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] transition-colors"
            >
              <Bell size={13} />
              {t("account.notifications")}
            </Link>
            {account.entitlement.tier === "creator" ? (
              <Link
                href="/admin/costs"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12.5px] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] transition-colors"
              >
                <Activity size={13} />
                {t("account.aiCosts")}
              </Link>
            ) : null}
            {account.authBypass ? null : (
              <Button variant="ghost" size="sm" onClick={signOut} disabled={signingOut}>
                <LogOut size={13} />
                {signingOut ? t("account.signingOut") : t("account.signOut")}
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      {account.authBypass ? null : (
        <SectionCard title={t("sessions.title")} description={t("sessions.description")}>
          <SessionsPanel />
        </SectionCard>
      )}

      <SectionCard title={t("language.title")} description={t("language.description")}>
        <LanguagePicker />
      </SectionCard>

      <SectionCard title={t("appearance.title")} description={t("appearance.description")}>
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {(
            [
              { key: "system", icon: Monitor },
              { key: "light", icon: Sun },
              { key: "dark", icon: Moon },
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
                  {t(`appearance.${opt.key}`)}
                  {active ? <Check size={12} className="text-[var(--accent)]" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title={t("model.title")} description={t("model.description")}>
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
                    <div className="text-[13.5px] text-[var(--fg)]">
                      {t(`model.options.${p.id}.label`)}
                    </div>
                  </div>
                  <Badge tone={primaryProvider(p) === "anthropic" ? "ember" : "mist"}>
                    {primaryProvider(p)}
                  </Badge>
                </div>
                <div className="text-[12px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
                  {t(`model.options.${p.id}.description`)}
                </div>
                <div className="text-[11px] text-[var(--fg-subtle)] mt-1">
                  {t("model.routes", {
                    fast: routeLine(p.routes.fast),
                    deep: routeLine(p.routes.deep),
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title={t("behavior.title")} description={t("behavior.description")}>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <Stat label={t("behavior.promptVersion")} value="triage.v1" />
          <Stat
            label={t("behavior.triageModel")}
            value={MODELS[activePreference.routes.fast.primary].label}
          />
          <Stat label={t("behavior.minDelay")} value="450 ms" />
          <Stat label={t("behavior.editedProtected")} value={t("behavior.yes")} />
        </div>
      </SectionCard>

      <SectionCard title={t("data.title")} description={t("data.description")}>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/account/export"
            download
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Download size={14} />
            {t("data.export")}
          </a>
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm(t("data.resetConfirm"))) {
                window.localStorage.removeItem("sifty-store-v1");
                window.localStorage.removeItem("sifty-sync-ledger-v1");
                window.location.reload();
              }
            }}
          >
            {t("data.resetCache")}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-[var(--fg-subtle)] max-w-prose">
          {t("data.exportNote")}
        </p>
      </SectionCard>

      {account.authBypass || account.entitlement.tier === "creator" ? null : (
        <SectionCard title={t("deleteAccount.title")} description={t("deleteAccount.description")}>
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
  const t = useTranslations("settings.deleteAccount");
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
        throw new Error(data.error ?? t("error"));
      }
      // The server already dropped the session; clear this browser's copy
      // of the workspace so nothing of it lingers for the next sign-in.
      resetLocalWorkspace();
      window.localStorage.removeItem("sifty-store-v1");
      window.location.href = "/sign-in?deleted=1";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
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
        {t("open")}
      </Button>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent placement="center" className="w-[min(480px,calc(100vw-32px))]">
          <div className="px-5 pt-5 pb-2">
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription className="mt-1.5 text-[13px] leading-[1.5]">
              {t.rich("dialogBody", {
                email,
                hl: (chunks) => <span className="text-[var(--fg)]">{chunks}</span>,
              })}
            </DialogDescription>
          </div>
          <div className="px-5 pb-4">
            <label htmlFor="delete-account-confirm" className="text-eyebrow mb-1.5 block">
              {t("confirmLabel")}
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
              {t("keep")}
            </Button>
            <Button
              variant="primary"
              onClick={confirmDelete}
              disabled={!matches || pending}
              className="bg-[var(--warn)] text-white"
            >
              {pending ? t("deleting") : t("confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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

function siftsLine(ent: Entitlement, t: ReturnType<typeof useTranslations<"settings">>): string {
  if (!Number.isFinite(ent.caps.siftsPerDay)) {
    return t("account.siftsUnlimited", { count: ent.siftsToday });
  }
  if (ent.tier === "free") {
    return t("account.siftsFree", { used: ent.siftsToday, cap: ent.caps.siftsPerDay });
  }
  return t("account.siftsFairUse", { count: ent.siftsToday, cap: ent.caps.siftsPerDay });
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
