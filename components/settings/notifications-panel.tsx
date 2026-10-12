"use client";

import { Button } from "@/components/ui/button";
import type { NotificationPreferencesInput } from "@/lib/db/repos/types";
import { DEFAULT_PREFERENCES, type ResolvedPreferences } from "@/lib/notifications/preferences";
import {
  PushPermissionDeniedError,
  getCurrentSubscription,
  isIOS,
  isStandalone,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/notifications/push-client";
import { cn } from "@/lib/utils/cn";
import { Bell, BellOff, Check, Mail } from "lucide-react";
import * as React from "react";

interface PreferencesResponse {
  preferences: ResolvedPreferences;
  pushConfigured: boolean;
  pushSubscriptions: Array<{
    id: string;
    endpoint: string;
    userAgent: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  }>;
  recentSends: Array<{
    kind: string;
    channel: string;
    periodKey: string;
    status: string;
    sentAt: string | null;
  }>;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const KIND_LABEL: Record<string, string> = {
  morning_plan: "Morning plan",
  due_reminder: "Due reminder",
  weekly_review: "Weekly review",
};

/**
 * Settings → Notifications.
 *
 * Changes save on their own (like Appearance and AI model); the first save
 * is explicit because it is what opts the account into digests — until the
 * row exists the cron skips the user, so the banner says so.
 */
export function NotificationsPanel({
  email,
  vapidPublicKey,
  unsubscribed,
}: {
  email: string;
  /** Null when the server has no VAPID keys: push is hidden. */
  vapidPublicKey: string | null;
  unsubscribed: string | null;
}) {
  const [data, setData] = React.useState<PreferencesResponse | null>(null);
  const [prefs, setPrefs] = React.useState<NotificationPreferencesInput | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushMessage, setPushMessage] = React.useState<string | null>(null);
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = React.useState(false);
  const detectedZone = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const zones = React.useMemo(() => timeZoneOptions(detectedZone), [detectedZone]);
  const support = React.useMemo(() => pushSupport(), []);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/notifications/preferences", { credentials: "include" });
    if (!res.ok) throw new Error("Couldn't load notification settings.");
    const json = (await res.json()) as PreferencesResponse;
    setData(json);
    const { saved: wasSaved, updatedAt: _u, ...rest } = json.preferences;
    setSaved(wasSaved);
    // A fresh account gets the browser's zone pre-filled, not UTC.
    setPrefs(wasSaved ? rest : { ...rest, timezone: detectedZone });
  }, [detectedZone]);

  React.useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    getCurrentSubscription()
      .then((s) => setThisDeviceSubscribed(!!s))
      .catch(() => undefined);
  }, [load]);

  const save = React.useCallback(async (next: NotificationPreferencesInput) => {
    setSaveState("saving");
    setError(null);
    const res = await fetch("/api/notifications/preferences", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveState("error");
      setError(body.error ?? "Couldn't save.");
      return false;
    }
    setSaved(true);
    setSaveState("saved");
    return true;
  }, []);

  // Autosave after the first explicit save; before that, edits only stage.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (patch: Partial<NotificationPreferencesInput>) => {
    setPrefs((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (saved) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void save(next), 400);
      }
      return next;
    });
  };

  const enablePush = async () => {
    if (!prefs || !vapidPublicKey) return;
    setPushBusy(true);
    setPushMessage(null);
    try {
      const subscription = await subscribeToPush(vapidPublicKey);
      const res = await fetch("/api/notifications/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error("Couldn't register this device.");
      setThisDeviceSubscribed(true);
      const next = { ...prefs, pushEnabled: true };
      setPrefs(next);
      if (await save(next)) await load();
    } catch (err) {
      setPushMessage(
        err instanceof PushPermissionDeniedError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't turn on notifications.",
      );
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    if (!prefs) return;
    setPushBusy(true);
    setPushMessage(null);
    try {
      const endpoint = await unsubscribeFromPush();
      let remaining = data?.pushSubscriptions.length ?? 0;
      if (endpoint) {
        const res = await fetch("/api/notifications/push/subscribe", {
          method: "DELETE",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        const body = (await res.json().catch(() => ({}))) as { removed?: boolean };
        if (body.removed) remaining -= 1;
      }
      setThisDeviceSubscribed(false);
      // This control is per device; the account-wide channel only goes off
      // when no other device would still receive pushes.
      if (remaining <= 0) {
        const next = { ...prefs, pushEnabled: false };
        setPrefs(next);
        if (await save(next)) await load();
      } else {
        await load();
      }
    } finally {
      setPushBusy(false);
    }
  };

  const sendTest = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const res = await fetch("/api/notifications/push/test", {
        method: "POST",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        delivered?: number;
        removed?: number;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send a test.");
      setPushMessage(
        body.delivered
          ? `Sent to ${body.delivered} device${body.delivered === 1 ? "" : "s"}.`
          : "No device accepted the test — re-enable notifications on this device.",
      );
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : "Couldn't send a test.");
    } finally {
      setPushBusy(false);
    }
  };

  if (!prefs || !data) {
    return (
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        {error ?? "Loading notification settings…"}
      </div>
    );
  }

  const showIosHint = isIOS() && !isStandalone();

  return (
    <div className="max-w-2xl" data-testid="notifications-panel">
      {unsubscribed === "1" ? (
        <Notice tone="ok">Digest emails are off. Account and security emails still arrive.</Notice>
      ) : null}
      {unsubscribed === "invalid" ? (
        <Notice tone="warn">
          That unsubscribe link was not valid. Use the switch below instead.
        </Notice>
      ) : null}
      {!saved ? (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Reminders are off until you confirm your time zone ({prefs.timezone}). Check the
              settings below, then turn them on.
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save(prefs)}
              disabled={saveState === "saving"}
              data-testid="turn-on-reminders"
            >
              <Bell size={13} />
              Turn on reminders
            </Button>
          </div>
        </Notice>
      ) : null}

      <Section title="Channels" description="Where digests go. Turn both off to pause everything.">
        <Row
          icon={Mail}
          title="Email"
          detail={email}
          control={
            <Switch
              checked={prefs.emailEnabled}
              onChange={(v) => update({ emailEnabled: v })}
              label="Email digests"
            />
          }
        />
        {vapidPublicKey ? (
          <Row
            icon={prefs.pushEnabled ? Bell : BellOff}
            title="Notifications on this device"
            detail={pushDetail(support, thisDeviceSubscribed, data.pushSubscriptions.length)}
            control={
              support.ok ? (
                thisDeviceSubscribed ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={sendTest} disabled={pushBusy}>
                      Send a test
                    </Button>
                    <Button variant="secondary" size="sm" onClick={disablePush} disabled={pushBusy}>
                      Turn off
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={enablePush}
                    disabled={pushBusy}
                    data-testid="enable-push"
                  >
                    {pushBusy ? "Asking…" : "Turn on"}
                  </Button>
                )
              ) : null
            }
          />
        ) : (
          <Row
            icon={BellOff}
            title="Notifications"
            detail="Not set up on this server yet (VAPID keys missing). Email still works."
          />
        )}
        {showIosHint ? (
          <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--fg-muted)]">
            On iPhone and iPad, notifications only reach installed apps: tap{" "}
            <span className="text-[var(--fg)]">Share</span> →{" "}
            <span className="text-[var(--fg)]">Add to Home Screen</span>, open Sifty from there, and
            turn notifications on in this screen (iOS 16.4 or later).
          </p>
        ) : null}
        {pushMessage ? (
          <p role="status" className="mt-2 text-[12.5px] text-[var(--fg-muted)]">
            {pushMessage}
          </p>
        ) : null}
      </Section>

      <Section
        title="Schedule"
        description="Times are in your time zone. Digests only go out when there is something to say."
      >
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
          <Field label="Time zone">
            <div className="flex items-center gap-2">
              <select
                aria-label="Time zone"
                value={prefs.timezone}
                onChange={(e) => update({ timezone: e.target.value })}
                className={selectClass}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {prefs.timezone !== detectedZone ? (
                <Button variant="link" size="sm" onClick={() => update({ timezone: detectedZone })}>
                  Use {detectedZone.replace(/_/g, " ")}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field
            label="Morning plan"
            hint="Today, Focus, and anything due or overdue."
            control={
              <Switch
                checked={prefs.morningPlanEnabled}
                onChange={(v) => update({ morningPlanEnabled: v })}
                label="Morning plan"
              />
            }
          >
            <HourSelect
              label="Morning plan time"
              value={prefs.morningPlanHour}
              disabled={!prefs.morningPlanEnabled}
              onChange={(h) => update({ morningPlanHour: h })}
            />
          </Field>
          <Field
            label="Due reminder"
            hint="An afternoon nudge for what is still due today or overdue."
            control={
              <Switch
                checked={prefs.dueRemindersEnabled}
                onChange={(v) => update({ dueRemindersEnabled: v })}
                label="Due reminders"
              />
            }
          >
            <HourSelect
              label="Due reminder time"
              value={prefs.dueReminderHour}
              disabled={!prefs.dueRemindersEnabled}
              onChange={(h) => update({ dueReminderHour: h })}
            />
          </Field>
          <Field
            label="Weekly review"
            hint="What got done, what slipped, what the week holds. Sent at the morning plan time."
            control={
              <Switch
                checked={prefs.weeklyReviewEnabled}
                onChange={(v) => update({ weeklyReviewEnabled: v })}
                label="Weekly review"
              />
            }
          >
            <select
              aria-label="Weekly review day"
              value={prefs.weeklyReviewDay}
              disabled={!prefs.weeklyReviewEnabled}
              onChange={(e) => update({ weeklyReviewDay: Number(e.target.value) })}
              className={selectClass}
            >
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Quiet hours"
            hint="Anything scheduled inside this window waits until it ends."
            control={
              <Switch
                checked={prefs.quietHoursStart !== null}
                onChange={(v) =>
                  update(
                    v
                      ? { quietHoursStart: 22, quietHoursEnd: 7 }
                      : { quietHoursStart: null, quietHoursEnd: null },
                  )
                }
                label="Quiet hours"
              />
            }
          >
            {prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null ? (
              <div className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
                <HourSelect
                  label="Quiet hours start"
                  value={prefs.quietHoursStart}
                  onChange={(h) => update({ quietHoursStart: h })}
                />
                <span>to</span>
                <HourSelect
                  label="Quiet hours end"
                  value={prefs.quietHoursEnd}
                  onChange={(h) => update({ quietHoursEnd: h })}
                />
              </div>
            ) : null}
          </Field>
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--fg-subtle)]">
          <span role="status">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? (error ?? "Couldn't save")
                  : saved
                    ? "Changes save automatically."
                    : ""}
          </span>
          {saved ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => update({ ...DEFAULT_PREFERENCES, timezone: prefs.timezone })}
            >
              Reset to defaults
            </Button>
          ) : null}
        </div>
      </Section>

      {data.recentSends.length > 0 ? (
        <Section title="Recent" description="The last few digests Sifty sent you.">
          <ul className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
            {data.recentSends.map((s) => (
              <li
                key={`${s.kind}-${s.channel}-${s.periodKey}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="text-[var(--fg)]">
                  {KIND_LABEL[s.kind] ?? s.kind}
                  <span className="text-[var(--fg-muted)]"> · {s.channel}</span>
                </span>
                <span className="text-[var(--fg-muted)]">
                  {s.periodKey} · {s.status}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

const selectClass =
  "h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[13px] text-[var(--fg)] disabled:opacity-40";

function pushDetail(
  support: ReturnType<typeof pushSupport>,
  thisDevice: boolean,
  total: number,
): string {
  if (!support.ok) {
    switch (support.reason) {
      case "ios_not_installed":
        return "Add Sifty to your Home Screen first — see below.";
      case "insecure":
        return "Needs https.";
      default:
        return "This browser cannot receive push notifications.";
    }
  }
  if (thisDevice) {
    return total > 1
      ? `On for this device and ${total - 1} other${total - 1 === 1 ? "" : "s"}.`
      : "On for this device.";
  }
  return total > 0
    ? `Off here; on for ${total} other device${total === 1 ? "" : "s"}.`
    : "Reminders as system notifications, even when Sifty is closed.";
}

function timeZoneOptions(detected: string): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const set = new Set<string>(["UTC", detected, ...supported]);
  return Array.from(set).sort();
}

function HourSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (hour: number) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      {HOURS.map((h) => (
        <option key={formatHour(h)} value={h}>
          {formatHour(h)}
        </option>
      ))}
    </select>
  );
}

export function formatHour(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]",
        checked
          ? "border-[var(--accent)] bg-[var(--accent)]"
          : "border-[var(--border-strong)] bg-[var(--surface-muted)]",
      )}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      >
        {checked ? <Check size={10} className="text-[var(--accent)]" /> : null}
      </span>
    </button>
  );
}

function Row({
  icon: Icon,
  title,
  detail,
  control,
}: {
  icon: typeof Mail;
  title: string;
  detail: string;
  control?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 mb-2">
      <div className="flex min-w-0 items-center gap-3">
        <Icon size={15} className="shrink-0 text-[var(--fg-muted)]" />
        <div className="min-w-0">
          <div className="text-[13.5px] text-[var(--fg)]">{title}</div>
          <div className="truncate text-[12px] text-[var(--fg-muted)]">{detail}</div>
        </div>
      </div>
      {control}
    </div>
  );
}

function Field({
  label,
  hint,
  control,
  children,
}: {
  label: string;
  hint?: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] text-[var(--fg)]">{label}</div>
          {hint ? <div className="text-[12px] text-[var(--fg-muted)] mt-0.5">{hint}</div> : null}
        </div>
        {control}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function Section({
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
        <p className="mb-3 max-w-prose text-[13px] leading-[1.5] text-[var(--fg-muted)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

function Notice({ tone, children }: { tone: "ok" | "warn" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={cn(
        "mt-6 rounded-[var(--radius-md)] border px-4 py-3 text-[13px] leading-[1.5]",
        tone === "ok" && "border-[var(--done)]/40 bg-[var(--surface)] text-[var(--fg)]",
        tone === "warn" && "border-[var(--warn)]/40 bg-[var(--surface)] text-[var(--fg)]",
        tone === "info" && "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--fg)]",
      )}
    >
      {children}
    </div>
  );
}
