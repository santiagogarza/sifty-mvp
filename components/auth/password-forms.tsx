"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuthErrorMessage } from "./use-auth-error";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const authErrorMessage = useAuthErrorMessage();
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (error) return setError(authErrorMessage(error));
      setDone(true);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p data-testid="reset-sent" className="text-[13.5px] text-[var(--fg)] leading-[1.5]">
        {t("forgotPassword.sent", { email })}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor="forgot-email" className="text-[13px] text-[var(--fg-muted)]">
          {t("form.email")}
        </label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5"
          placeholder={t("form.emailPlaceholder")}
        />
      </div>
      {error ? (
        <div role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="mt-2">
        {pending ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const authErrorMessage = useAuthErrorMessage();
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) return setError(authErrorMessage(error));
      router.push("/sign-in?reset=1");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor="reset-password" className="text-[13px] text-[var(--fg-muted)]">
          {t("resetPassword.newPassword")}
        </label>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5"
          placeholder={t("form.passwordPlaceholder")}
        />
      </div>
      {error ? (
        <div role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="mt-2">
        {pending ? t("resetPassword.submitting") : t("resetPassword.submit")}
      </Button>
    </form>
  );
}
