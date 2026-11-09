"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { safeNextPath } from "@/lib/auth/safe-next";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { GoogleButton } from "./google-button";
import { useAuthErrorMessage } from "./use-auth-error";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next?: string;
  /** Hidden until GOOGLE_CLIENT_ID/SECRET exist on the server. */
  googleEnabled: boolean;
}

type Sent = { kind: "verify" | "magic"; email: string } | null;

export function AuthForm({ mode, next, googleEnabled }: AuthFormProps) {
  const router = useRouter();
  const t = useTranslations("auth");
  const authErrorMessage = useAuthErrorMessage();
  // Origin only matters for the same-origin comparison; the result is a path.
  const callbackURL = safeNextPath(next, "http://sifty.local");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"password" | "magic" | "google" | null>(null);
  const [sent, setSent] = React.useState<Sent>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending("password");
    try {
      if (mode === "sign-up") {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: displayName.trim() || email.split("@")[0]!,
          callbackURL,
        });
        if (error) return setError(authErrorMessage(error));
        setSent({ kind: "verify", email });
        return;
      }
      const { error } = await authClient.signIn.email({ email, password, callbackURL });
      if (error) {
        if (error.code === "EMAIL_NOT_VERIFIED") setSent({ kind: "verify", email });
        return setError(authErrorMessage(error));
      }
      router.push(callbackURL);
      router.refresh();
    } catch (err) {
      setError(t("errors.network"));
    } finally {
      setPending(null);
    }
  }

  async function onMagicLink() {
    setError(null);
    if (!email) return setError(t("form.enterEmailFirst"));
    setPending("magic");
    try {
      const { error } = await authClient.signIn.magicLink({ email, callbackURL });
      if (error) return setError(authErrorMessage(error));
      setSent({ kind: "magic", email });
    } finally {
      setPending(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setPending("google");
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        errorCallbackURL: `/sign-in?next=${encodeURIComponent(callbackURL)}`,
      });
      if (error) {
        setError(authErrorMessage(error));
        setPending(null);
      }
      // On success the browser is navigating to Google; keep the form disabled.
    } catch (err) {
      setError(t("errors.network"));
      setPending(null);
    }
  }

  if (sent) {
    return <CheckInbox sent={sent} callbackURL={callbackURL} onBack={() => setSent(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {googleEnabled ? (
        <>
          <GoogleButton onClick={onGoogle} pending={pending === "google"} />
          <Divider />
        </>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <div>
          <label htmlFor="auth-email" className="text-[13px] text-[var(--fg-muted)]">
            {t("form.email")}
          </label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5"
            placeholder={t("form.emailPlaceholder")}
          />
        </div>
        {mode === "sign-up" ? (
          <div>
            <label htmlFor="auth-name" className="text-[13px] text-[var(--fg-muted)]">
              {t("form.displayName")}
            </label>
            <Input
              id="auth-name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5"
              placeholder="Santi"
            />
          </div>
        ) : null}
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="auth-password" className="text-[13px] text-[var(--fg-muted)]">
              {t("form.password")}
            </label>
            {mode === "sign-in" ? (
              <Link
                href="/forgot-password"
                className="text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                {t("form.forgotPassword")}
              </Link>
            ) : null}
          </div>
          <Input
            id="auth-password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={mode === "sign-up" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5"
            placeholder={mode === "sign-up" ? t("form.passwordPlaceholder") : ""}
          />
        </div>
        {error ? (
          <div
            role="alert"
            data-testid="auth-error"
            className="text-[13px] text-[var(--warn)] mt-1"
          >
            {error}
          </div>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending !== null} className="mt-2">
          {pending === "password"
            ? mode === "sign-up"
              ? t("form.creatingAccount")
              : t("form.signingIn")
            : mode === "sign-up"
              ? t("form.createAccount")
              : t("form.signIn")}
        </Button>
      </form>

      {mode === "sign-in" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onMagicLink}
          disabled={pending !== null}
          className="self-center"
        >
          {pending === "magic" ? t("form.sendingLink") : t("form.magicLink")}
        </Button>
      ) : null}
    </div>
  );
}

function CheckInbox({
  sent,
  callbackURL,
  onBack,
}: { sent: NonNullable<Sent>; callbackURL: string; onBack: () => void }) {
  const t = useTranslations("auth");
  const authErrorMessage = useAuthErrorMessage();
  const [resent, setResent] = React.useState(false);
  const [resendError, setResendError] = React.useState<string | null>(null);
  async function resend() {
    setResendError(null);
    try {
      const { error } =
        sent.kind === "verify"
          ? await authClient.sendVerificationEmail({ email: sent.email, callbackURL })
          : await authClient.signIn.magicLink({ email: sent.email, callbackURL });
      if (error) return setResendError(authErrorMessage(error));
      setResent(true);
    } catch (err) {
      setResendError(t("errors.network"));
    }
  }
  return (
    <div data-testid="auth-check-inbox">
      <h2 className="text-[16px] text-[var(--fg)]">{t("checkInbox.title")}</h2>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
        {sent.kind === "verify"
          ? t("checkInbox.verify", { email: sent.email })
          : t("checkInbox.magic", { email: sent.email })}
      </p>
      {resendError ? (
        <div role="alert" className="mt-2 text-[13px] text-[var(--warn)]">
          {resendError}
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={resend} disabled={resent}>
          {resent ? t("checkInbox.resent") : t("checkInbox.resend")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("checkInbox.differentEmail")}
        </Button>
      </div>
    </div>
  );
}

function Divider() {
  const t = useTranslations("auth.form");
  return (
    <div className="flex items-center gap-3 text-[12px] text-[var(--fg-subtle)]">
      <div className="h-px flex-1 bg-[var(--border)]" />
      {t("or")}
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
