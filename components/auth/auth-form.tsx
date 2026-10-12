"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { GoogleButton } from "./google-button";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next?: string;
  /** Hidden until GOOGLE_CLIENT_ID/SECRET exist on the server. */
  googleEnabled: boolean;
}

type Sent = { kind: "verify" | "magic"; email: string } | null;

export function AuthForm({ mode, next, googleEnabled }: AuthFormProps) {
  const router = useRouter();
  const callbackURL = safeNext(next);
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
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPending(null);
    }
  }

  async function onMagicLink() {
    setError(null);
    if (!email) return setError("Enter your email first.");
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
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL });
      if (error) {
        setError(authErrorMessage(error));
        setPending(null);
      }
      // On success the browser is navigating to Google; keep the form disabled.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPending(null);
    }
  }

  if (sent) {
    return <CheckInbox sent={sent} onBack={() => setSent(null)} />;
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
            Email
          </label>
          <Input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5"
            placeholder="you@example.com"
          />
        </div>
        {mode === "sign-up" ? (
          <div>
            <label htmlFor="auth-name" className="text-[13px] text-[var(--fg-muted)]">
              Display name (optional)
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
              Password
            </label>
            {mode === "sign-in" ? (
              <Link
                href="/forgot-password"
                className="text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                Forgot password?
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
            placeholder={mode === "sign-up" ? "At least 8 characters" : ""}
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
              ? "Creating account…"
              : "Signing in…"
            : mode === "sign-up"
              ? "Create account"
              : "Sign in"}
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
          {pending === "magic" ? "Sending link…" : "Email me a sign-in link instead"}
        </Button>
      ) : null}
    </div>
  );
}

function CheckInbox({ sent, onBack }: { sent: NonNullable<Sent>; onBack: () => void }) {
  const [resent, setResent] = React.useState(false);
  const [resendError, setResendError] = React.useState<string | null>(null);
  async function resend() {
    setResendError(null);
    try {
      const { error } =
        sent.kind === "verify"
          ? await authClient.sendVerificationEmail({ email: sent.email, callbackURL: "/today" })
          : await authClient.signIn.magicLink({ email: sent.email, callbackURL: "/today" });
      if (error) return setResendError(authErrorMessage(error));
      setResent(true);
    } catch (err) {
      setResendError(err instanceof Error ? err.message : "Network error");
    }
  }
  return (
    <div data-testid="auth-check-inbox">
      <h2 className="text-[16px] text-[var(--fg)]">Check your inbox</h2>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1.5 leading-[1.5]">
        {sent.kind === "verify"
          ? `We sent a confirmation link to ${sent.email}. Open it to finish setting up your account.`
          : `We sent a sign-in link to ${sent.email}. It works once and expires in 5 minutes.`}
      </p>
      {resendError ? (
        <div role="alert" className="mt-2 text-[13px] text-[var(--warn)]">
          {resendError}
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={resend} disabled={resent}>
          {resent ? "Sent again" : "Resend"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Use a different email
        </Button>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-[var(--fg-subtle)]">
      <div className="h-px flex-1 bg-[var(--border)]" />
      or
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

/** Only same-origin paths; anything else falls back to /today. */
function safeNext(next?: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/today";
  return next;
}
