"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

interface RedeemResponse {
  ok?: true;
  tier?: string;
  compedUntil?: string | null;
  error?: string;
}

/**
 * Invite-code redemption. Used on `/redeem` (prefilled from the URL) and in
 * Settings → Billing. On success the page refreshes so server-rendered
 * entitlement copy picks up the new tier.
 */
export function RedeemInviteForm({
  initialCode = "",
  autoSubmit = false,
  onRedeemed,
}: {
  initialCode?: string;
  /** Submit on mount when a code was supplied (the `/redeem?code=` path). */
  autoSubmit?: boolean;
  onRedeemed?: (result: { tier: string; compedUntil: string | null }) => void;
}) {
  const router = useRouter();
  const [code, setCode] = React.useState(initialCode);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ tier: string; compedUntil: string | null } | null>(null);
  const submittedOnMount = React.useRef(false);

  const submit = React.useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Enter an invite code.");
        return;
      }
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/invites/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: trimmed }),
        });
        const data = (await res.json().catch(() => ({}))) as RedeemResponse;
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Could not redeem that code.");
          return;
        }
        const result = { tier: data.tier ?? "comped", compedUntil: data.compedUntil ?? null };
        setDone(result);
        onRedeemed?.(result);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setPending(false);
      }
    },
    [onRedeemed, router],
  );

  React.useEffect(() => {
    if (autoSubmit && initialCode && !submittedOnMount.current) {
      submittedOnMount.current = true;
      void submit(initialCode);
    }
  }, [autoSubmit, initialCode, submit]);

  if (done) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-3.5 py-3 text-[13px] text-[var(--fg)]"
      >
        <Check size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <span>
          {done.tier === "creator"
            ? "Code accepted. The creator account is already unlimited."
            : done.compedUntil
              ? `You're on Pro until ${new Date(done.compedUntil).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}. Unlimited sifting, no card needed.`
              : "You're on Pro. Unlimited sifting, no card needed."}
        </span>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
    >
      <label htmlFor="invite-code" className="text-[13px] text-[var(--fg-muted)]">
        Invite code
      </label>
      <div className="flex gap-2">
        <Input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="sifty-…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="font-mono"
          disabled={pending}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Redeeming…" : "Redeem"}
        </Button>
      </div>
      {error ? (
        <div role="alert" className="text-[13px] text-[var(--warn)]">
          {error}
        </div>
      ) : null}
    </form>
  );
}
