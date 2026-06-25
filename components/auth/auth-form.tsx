"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import * as React from "react";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next?: string;
}

export function AuthForm({ mode, next }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const url = mode === "sign-up" ? "/api/auth/sign-up" : "/api/auth/sign-in";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(mode === "sign-up" && displayName ? { displayName } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong.");
        setPending(false);
        return;
      }
      router.push(next ?? "/today");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setPending(false);
    }
  }

  return (
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
        <label htmlFor="auth-password" className="text-[13px] text-[var(--fg-muted)]">
          Password
        </label>
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
        <div role="alert" data-testid="auth-error" className="text-[13px] text-[var(--warn)] mt-1">
          {error}
        </div>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="mt-2">
        {pending
          ? mode === "sign-up"
            ? "Creating account…"
            : "Signing in…"
          : mode === "sign-up"
            ? "Create account"
            : "Sign in"}
      </Button>
    </form>
  );
}
