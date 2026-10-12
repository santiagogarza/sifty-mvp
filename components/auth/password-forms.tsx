"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import * as React from "react";

export function ForgotPasswordForm() {
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
        If an account exists for {email}, a reset link is on its way. It expires in one hour.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div>
        <label htmlFor="forgot-email" className="text-[13px] text-[var(--fg-muted)]">
          Email
        </label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5"
          placeholder="you@example.com"
        />
      </div>
      {error ? (
        <div role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="mt-2">
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
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
          New password
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
          placeholder="At least 8 characters"
        />
      </div>
      {error ? (
        <div role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="mt-2">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
