"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionView } from "@/lib/connectors/service";
import { cn } from "@/lib/utils/cn";
import { AlertTriangle, Check, Link2, Lock, RefreshCw, Unplug } from "lucide-react";
import Link from "next/link";
import * as React from "react";

interface ConnectionsResponse {
  allowed: boolean;
  providers: ConnectionView[];
  proRequiredMessage: string | null;
}

/**
 * Settings → Connections.
 *
 * One card per provider: what connecting lets Sifty do, the scopes in plain
 * words split into "reads" and "can do", and the connection state. Connect
 * navigates to the broker's consent page; the callback brings the user back
 * here with `?connected=` or `?error=`, which the page passes in as
 * `notice`. Nothing on this page ever sees a token.
 */
export function ConnectionsPanel({
  notice,
}: {
  notice: { kind: "connected"; provider: string } | { kind: "error"; message: string } | null;
}) {
  const [data, setData] = React.useState<ConnectionsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    const res = await fetch("/api/connectors", { credentials: "include" });
    if (!res.ok) throw new Error("Couldn't load connections.");
    setData((await res.json()) as ConnectionsResponse);
  }, []);

  React.useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const setRowError = (provider: string, message: string | null) =>
    setRowErrors((current) => {
      const next = { ...current };
      if (message) next[provider] = message;
      else delete next[provider];
      return next;
    });

  const connect = async (provider: string) => {
    setBusy(provider);
    setRowError(provider, null);
    try {
      const res = await fetch(`/api/connectors/${provider}/start`, {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Couldn't start the connection.");
      window.location.assign(body.url);
    } catch (err) {
      setRowError(provider, err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const disconnect = async (provider: string, name: string) => {
    if (
      !confirm(
        `Disconnect ${name}? Sifty will no longer be able to use it until you connect again.`,
      )
    )
      return;
    setBusy(provider);
    setRowError(provider, null);
    try {
      const res = await fetch(`/api/connectors/${provider}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't disconnect.");
      }
      await load();
    } catch (err) {
      setRowError(provider, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const check = async (provider: string) => {
    setBusy(provider);
    setRowError(provider, null);
    try {
      const res = await fetch(`/api/connectors/${provider}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Couldn't check the connection.");
      }
      await load();
    } catch (err) {
      setRowError(provider, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 max-w-2xl">
      {notice?.kind === "connected" ? (
        <Notice tone="ok" testId="connections-notice">
          <Check size={14} />
          Connected {displayName(data, notice.provider)}. Sifty can use it from now on.
        </Notice>
      ) : null}
      {notice?.kind === "error" ? (
        <Notice tone="warn" testId="connections-notice">
          <AlertTriangle size={14} />
          {notice.message}
        </Notice>
      ) : null}

      {data && !data.allowed ? (
        <Notice tone="info" testId="connections-pro-required">
          <Lock size={14} />
          <span>
            {data.proRequiredMessage}{" "}
            <Link href="/settings/billing" className="underline underline-offset-2">
              See plans
            </Link>
          </span>
        </Notice>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </p>
      ) : null}

      {!data && !error ? (
        <p className="text-[13px] text-[var(--fg-muted)]">Loading connections…</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {data?.providers.map((p) => (
          <ProviderCard
            key={p.provider}
            view={p}
            busy={busy === p.provider}
            error={rowErrors[p.provider] ?? null}
            onConnect={() => connect(p.provider)}
            onDisconnect={() => disconnect(p.provider, p.name)}
            onCheck={() => check(p.provider)}
          />
        ))}
      </div>

      <p className="mt-4 text-[12px] text-[var(--fg-subtle)] max-w-prose">
        Sign-in tokens for these services are held by Vercel Connect, not in Sifty's database.
        Anything that would change something outside Sifty is drafted first and waits for your
        approval in Decisions.
      </p>
    </div>
  );
}

function ProviderCard({
  view,
  busy,
  error,
  onConnect,
  onDisconnect,
  onCheck,
}: {
  view: ConnectionView;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onCheck: () => void;
}) {
  const reads = view.scopes.filter((s) => s.kind === "read");
  const writes = view.scopes.filter((s) => s.kind === "write");
  const connected = view.status === "connected";
  const errored = view.status === "error";
  const canConnect = view.availability === "available" && !busy;

  return (
    <article
      data-testid={`connection-${view.provider}`}
      data-status={view.status}
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[14px] text-[var(--fg)]">{view.name}</div>
            <span className="text-[12px] text-[var(--fg-subtle)]">{view.tagline}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--fg-muted)] leading-[1.5]">
            {view.description}
          </p>
        </div>
        <StatusBadge view={view} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ScopeList title="Reads" items={reads.map((s) => s.label)} />
        <ScopeList title="Can do, once you approve" items={writes.map((s) => s.label)} />
      </div>

      {connected && view.externalAccount ? (
        <div className="mt-3 text-[12px] text-[var(--fg-muted)]">
          Connected as <span className="text-[var(--fg)]">{view.externalAccount}</span>
          {view.lastCheckedAt ? ` · checked ${relative(view.lastCheckedAt)}` : null}
        </div>
      ) : null}

      {errored && view.lastError ? (
        <p className="mt-3 text-[12.5px] text-[var(--warn)]">{view.lastError}</p>
      ) : null}

      {view.availability === "not_configured" ? (
        <p className="mt-3 text-[12.5px] text-[var(--fg-muted)]">
          Not available yet — {view.name} hasn't been set up on this Sifty.
          {view.configHint ? (
            <>
              {" "}
              Set <code className="text-[12px]">{view.configHint}</code> to the Vercel Connect
              connector UID and redeploy.
            </>
          ) : null}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-[var(--warn)]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        {connected || errored ? (
          <>
            <Button size="sm" variant="secondary" onClick={onCheck} disabled={busy}>
              <RefreshCw size={13} className={cn(busy && "animate-spin")} />
              Check
            </Button>
            {errored ? (
              <Button size="sm" variant="primary" onClick={onConnect} disabled={!canConnect}>
                <Link2 size={13} />
                Reconnect
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={busy}>
              <Unplug size={13} />
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={onConnect}
            disabled={!canConnect}
            data-testid={`connect-${view.provider}`}
          >
            {view.availability === "pro_required" ? <Lock size={13} /> : <Link2 size={13} />}
            {busy
              ? "Opening…"
              : view.status === "pending"
                ? "Continue connecting"
                : `Connect ${view.name}`}
          </Button>
        )}
        {view.mcp ? (
          <span className="ml-auto text-[11px] text-[var(--fg-subtle)]">
            {view.tools.length} tools · MCP
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-[var(--fg-subtle)]">
            {view.tools.length} tools
          </span>
        )}
      </div>
    </article>
  );
}

function StatusBadge({ view }: { view: ConnectionView }) {
  if (view.status === "connected") return <Badge tone="sage">Connected</Badge>;
  if (view.status === "error") return <Badge tone="rose">Needs attention</Badge>;
  if (view.status === "pending") return <Badge tone="mist">Connecting…</Badge>;
  if (view.availability === "not_configured") return <Badge tone="neutral">Not configured</Badge>;
  if (view.availability === "pro_required") return <Badge tone="neutral">Pro</Badge>;
  return <Badge tone="neutral">Not connected</Badge>;
}

function ScopeList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-eyebrow mb-1">{title}</div>
      <ul className="flex flex-col gap-0.5">
        {items.map((label) => (
          <li key={label} className="text-[12.5px] text-[var(--fg-muted)] leading-[1.5]">
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({
  tone,
  testId,
  children,
}: {
  tone: "ok" | "warn" | "info";
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        "mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-[13px] leading-[1.5]",
        tone === "ok" &&
          "border-transparent bg-[oklch(94%_0.02_160)] text-[var(--done)] dark:bg-[oklch(20%_0.02_160)]",
        tone === "warn" &&
          "border-transparent bg-[oklch(95%_0.02_18)] text-[var(--warn)] dark:bg-[oklch(22%_0.02_18)]",
        tone === "info" &&
          "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--fg-muted)]",
      )}
    >
      {children}
    </div>
  );
}

function displayName(data: ConnectionsResponse | null, provider: string): string {
  return data?.providers.find((p) => p.provider === provider)?.name ?? provider;
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
