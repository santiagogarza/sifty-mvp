"use client";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { Monitor, Smartphone } from "lucide-react";
import * as React from "react";

interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Lists the account's sessions and lets the user revoke any of them.
 * Backed by Better Auth's `list-sessions`, `revoke-session`, and
 * `revoke-other-sessions`.
 */
export function SessionsPanel() {
  const { data: current, isPending: currentPending } = authClient.useSession();
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const { data } = await authClient.listSessions();
    setSessions((data as SessionRow[] | null) ?? []);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function revoke(token: string) {
    setBusy(token);
    try {
      await authClient.revokeSession({ token });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("others");
    try {
      await authClient.revokeOtherSessions();
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Until the current session is known, every row would look revocable,
  // including this device's.
  if (sessions === null || currentPending || !current) {
    return <div className="text-[13px] text-[var(--fg-muted)]">Loading sessions…</div>;
  }

  const currentToken = current.session.token;
  const others = sessions.filter((s) => s.token !== currentToken);

  return (
    <div className="max-w-2xl">
      <ul className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
        {sessions.map((s) => {
          const isCurrent = s.token === currentToken;
          const device = describeDevice(s.userAgent);
          const Icon = device.mobile ? Smartphone : Monitor;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Icon size={15} className="text-[var(--fg-muted)] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13.5px] text-[var(--fg)] truncate">
                    {device.label}
                    {isCurrent ? (
                      <span className="ml-2 text-[11px] uppercase tracking-wide text-[var(--accent)]">
                        This device
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">
                    Last active {formatWhen(s.updatedAt)}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </div>
                </div>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => revoke(s.token)}
                >
                  {busy === s.token ? "Signing out…" : "Sign out"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {others.length ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={busy !== null}
          onClick={revokeOthers}
        >
          {busy === "others"
            ? "Signing out…"
            : `Sign out ${others.length} other device${others.length === 1 ? "" : "s"}`}
        </Button>
      ) : null}
    </div>
  );
}

function describeDevice(ua?: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /iPhone|Android|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

function formatWhen(value: string | Date): string {
  const d = new Date(value);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 2) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
