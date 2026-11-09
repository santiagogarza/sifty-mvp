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
import { useFormatter, useTranslations } from "next-intl";
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

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

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
  const t = useTranslations("account.notifications");
  const tc = useTranslations("common.states");
  const format = useFormatter();
  const [data, setData] = React.useState<PreferencesResponse | null>(null);
  const [prefs, setPrefs] = React.useState<NotificationPreferencesInput | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushMessage, setPushMessage] = React.useState<string | null>(null);
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = React.useState(false);
  /** What the server holds; a rejected autosave rolls the controls back to it. */
  const lastSaved = React.useRef<NotificationPreferencesInput | null>(null);
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
    if (!res.ok) throw new Error(t("loadFailed"));
    const json = (await res.json()) as PreferencesResponse;
    setData(json);
    const { saved: wasSaved, updatedAt: _u, ...rest } = json.preferences;
    setSaved(wasSaved);
    lastSaved.current = wasSaved ? rest : null;
    // A fresh account gets the browser's zone pre-filled, not UTC.
    setPrefs(wasSaved ? rest : { ...rest, timezone: detectedZone });
  }, [detectedZone, t]);

  React.useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    getCurrentSubscription()
      .then((s) => setThisDeviceSubscribed(!!s))
      .catch(() => undefined);
  }, [load]);

  const save = React.useCallback(
    async (next: NotificationPreferencesInput) => {
      setSaveState("saving");
      setError(null);
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        setSaveState("error");
        setError(t("schedule.saveFailed"));
        // The server kept the last good row; show that instead of the
        // rejected edit so the controls never disagree with what is stored.
        if (lastSaved.current) setPrefs(lastSaved.current);
        return false;
      }
      lastSaved.current = next;
      setSaved(true);
      setSaveState("saved");
      return true;
    },
    [t],
  );

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
      if (!res.ok) {
        throw new Error(
          res.status === 409
            ? t("pushMessages.tooManyDevices")
            : res.status === 503
              ? t("pushMessages.notConfigured")
              : t("pushMessages.registerFailed"),
        );
      }
      setThisDeviceSubscribed(true);
      const next = { ...prefs, pushEnabled: true };
      setPrefs(next);
      if (await save(next)) await load();
    } catch (err) {
      setPushMessage(
        err instanceof PushPermissionDeniedError
          ? t("pushMessages.permissionDenied")
          : err instanceof Error
            ? err.message
            : t("pushMessages.enableFailed"),
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
        delivered?: number;
        removed?: number;
      };
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? t("pushMessages.noSubscriptions")
            : res.status === 503
              ? t("pushMessages.notConfigured")
              : t("pushMessages.testFailed"),
        );
      }
      setPushMessage(
        body.delivered
          ? t("pushMessages.sent", { count: body.delivered })
          : t("pushMessages.noneAccepted"),
      );
    } catch (err) {
      setPushMessage(err instanceof Error ? err.message : t("pushMessages.testFailed"));
    } finally {
      setPushBusy(false);
    }
  };

  if (!prefs || !data) {
    return <div className="mt-6 text-[13px] text-[var(--fg-muted)]">{error ?? t("loading")}</div>;
  }

  const showIosHint = isIOS() && !isStandalone();
  const sendLabel = (group: "kind" | "channel" | "status", value: string) => {
    const key = `recent.${group}.${value}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : value;
  };

  return (
    <div className="max-w-2xl" data-testid="notifications-panel">
      {unsubscribed === "1" && !prefs.emailEnabled ? (
        <Notice tone="ok">{t("notices.unsubscribed")}</Notice>
      ) : null}
      {unsubscribed === "invalid" ? (
        <Notice tone="warn">{t("notices.unsubscribeInvalid")}</Notice>
      ) : null}
      {!saved ? (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("notices.confirmZone", { zone: prefs.timezone })}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save(prefs)}
              disabled={saveState === "saving"}
              data-testid="turn-on-reminders"
            >
              <Bell size={13} />
              {t("notices.turnOn")}
            </Button>
          </div>
        </Notice>
      ) : null}

      <Section title={t("channels.title")} description={t("channels.description")}>
        <Row
          icon={Mail}
          title={t("channels.email")}
          detail={email}
          control={
            <Switch
              checked={prefs.emailEnabled}
              onChange={(v) => update({ emailEnabled: v })}
              label={t("channels.emailSwitch")}
            />
          }
        />
        {vapidPublicKey ? (
          <Row
            icon={prefs.pushEnabled ? Bell : BellOff}
            title={t("channels.push")}
            detail={pushDetail(t, support, thisDeviceSubscribed, data.pushSubscriptions.length)}
            control={
              support.ok ? (
                thisDeviceSubscribed ? (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onClick={sendTest} disabled={pushBusy}>
                      {t("channels.sendTest")}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={disablePush} disabled={pushBusy}>
                      {t("channels.turnOff")}
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
                    {pushBusy ? t("channels.asking") : t("channels.turnOn")}
                  </Button>
                )
              ) : null
            }
          />
        ) : (
          <Row
            icon={BellOff}
            title={t("channels.pushUnavailable")}
            detail={t("channels.pushUnavailableDetail")}
          />
        )}
        {showIosHint ? (
          <p className="mt-2 text-[12.5px] leading-[1.5] text-[var(--fg-muted)]">
            {t.rich("channels.iosHint", {
              hl: (chunks) => <span className="text-[var(--fg)]">{chunks}</span>,
            })}
          </p>
        ) : null}
        {pushMessage ? (
          <p role="status" className="mt-2 text-[12.5px] text-[var(--fg-muted)]">
            {pushMessage}
          </p>
        ) : null}
      </Section>

      <Section title={t("schedule.title")} description={t("schedule.description")}>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
          <Field label={t("schedule.timeZone")}>
            <div className="flex items-center gap-2">
              <select
                aria-label={t("schedule.timeZone")}
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
                  {t("schedule.useZone", { zone: detectedZone.replace(/_/g, " ") })}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field
            label={t("schedule.morningPlan")}
            hint={t("schedule.morningPlanHint")}
            control={
              <Switch
                checked={prefs.morningPlanEnabled}
                onChange={(v) => update({ morningPlanEnabled: v })}
                label={t("schedule.morningPlan")}
              />
            }
          >
            <HourSelect
              label={t("schedule.morningPlanTime")}
              value={prefs.morningPlanHour}
              disabled={!prefs.morningPlanEnabled}
              onChange={(h) => update({ morningPlanHour: h })}
            />
          </Field>
          <Field
            label={t("schedule.dueReminder")}
            hint={t("schedule.dueReminderHint")}
            control={
              <Switch
                checked={prefs.dueRemindersEnabled}
                onChange={(v) => update({ dueRemindersEnabled: v })}
                label={t("schedule.dueRemindersSwitch")}
              />
            }
          >
            <HourSelect
              label={t("schedule.dueReminderTime")}
              value={prefs.dueReminderHour}
              disabled={!prefs.dueRemindersEnabled}
              onChange={(h) => update({ dueReminderHour: h })}
            />
          </Field>
          <Field
            label={t("schedule.weeklyReview")}
            hint={t("schedule.weeklyReviewHint")}
            control={
              <Switch
                checked={prefs.weeklyReviewEnabled}
                onChange={(v) => update({ weeklyReviewEnabled: v })}
                label={t("schedule.weeklyReview")}
              />
            }
          >
            <select
              aria-label={t("schedule.weeklyReviewDay")}
              value={prefs.weeklyReviewDay}
              disabled={!prefs.weeklyReviewEnabled}
              onChange={(e) => update({ weeklyReviewDay: Number(e.target.value) })}
              className={selectClass}
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {weekdayName(format, d)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("schedule.quietHours")}
            hint={t("schedule.quietHoursHint")}
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
                label={t("schedule.quietHours")}
              />
            }
          >
            {prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null ? (
              <div className="flex items-center gap-2 text-[13px] text-[var(--fg-muted)]">
                {t.rich("schedule.quietHoursRange", {
                  start: () => (
                    <HourSelect
                      label={t("schedule.quietHoursStart")}
                      value={prefs.quietHoursStart ?? 0}
                      onChange={(h) => update({ quietHoursStart: h })}
                    />
                  ),
                  end: () => (
                    <HourSelect
                      label={t("schedule.quietHoursEnd")}
                      value={prefs.quietHoursEnd ?? 0}
                      onChange={(h) => update({ quietHoursEnd: h })}
                    />
                  ),
                })}
              </div>
            ) : null}
          </Field>
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--fg-subtle)]">
          <span role="status">
            {saveState === "saving"
              ? tc("saving")
              : saveState === "saved"
                ? tc("saved")
                : saveState === "error"
                  ? (error ?? t("schedule.saveFailed"))
                  : saved
                    ? t("schedule.autosave")
                    : ""}
          </span>
          {saved ? (
            <Button
              variant="link"
              size="sm"
              onClick={() => update({ ...DEFAULT_PREFERENCES, timezone: prefs.timezone })}
            >
              {t("schedule.reset")}
            </Button>
          ) : null}
        </div>
      </Section>

      {data.recentSends.length > 0 ? (
        <Section title={t("recent.title")} description={t("recent.description")}>
          <ul className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
            {data.recentSends.map((s) => (
              <li
                key={`${s.kind}-${s.channel}-${s.periodKey}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="text-[var(--fg)]">
                  {sendLabel("kind", s.kind)}
                  <span className="text-[var(--fg-muted)]">
                    {" "}
                    · {sendLabel("channel", s.channel)}
                  </span>
                </span>
                <span className="text-[var(--fg-muted)]">
                  {s.periodKey} · {sendLabel("status", s.status)}
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

type Translate = ReturnType<typeof useTranslations<"account.notifications">>;
type Format = ReturnType<typeof useFormatter>;

function pushDetail(
  t: Translate,
  support: ReturnType<typeof pushSupport>,
  thisDevice: boolean,
  total: number,
): string {
  if (!support.ok) {
    switch (support.reason) {
      case "ios_not_installed":
        return t("pushDetail.iosNotInstalled");
      case "insecure":
        return t("pushDetail.insecure");
      default:
        return t("pushDetail.unsupported");
    }
  }
  if (thisDevice) {
    return total > 1
      ? t("pushDetail.onThisAndOthers", { count: total - 1 })
      : t("pushDetail.onThis");
  }
  return total > 0 ? t("pushDetail.offHereOnOthers", { count: total }) : t("pushDetail.pitch");
}

/** 0 = Sunday, matching `weeklyReviewDay`. 2023-01-01 was a Sunday. */
function weekdayName(format: Format, day: number): string {
  return format.dateTime(new Date(Date.UTC(2023, 0, 1 + day)), {
    weekday: "long",
    timeZone: "UTC",
  });
}

function formatHour(format: Format, h: number): string {
  return format.dateTime(new Date(Date.UTC(2000, 0, 1, h)), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
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
  const format = useFormatter();
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={selectClass}
    >
      {HOURS.map((h) => (
        <option key={h} value={h}>
          {formatHour(format, h)}
        </option>
      ))}
    </select>
  );
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
