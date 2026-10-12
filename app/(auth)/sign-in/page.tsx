import { AuthForm } from "@/components/auth/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth/auth";
import Link from "next/link";

export const metadata = { title: "Sign in to Sifty" };

const ERROR_COPY: Record<string, string> = {
  INVALID_TOKEN: "That link has expired or was already used. Sign in to get a new one.",
  EXPIRED_TOKEN: "That link has expired. Sign in to get a new one.",
  signup_disabled: "Sign-ups are closed right now.",
  account_not_linked:
    "An account with this email already exists. Sign in with your password, then connect Google from Settings.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const banner = params.error
    ? (ERROR_COPY[params.error] ?? "Sign-in failed. Try again.")
    : params.reset
      ? "Password updated. Sign in with your new password."
      : null;
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Welcome back</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">Sign in to your Sifty account.</p>
      {banner ? (
        <div
          role="alert"
          className={`mt-4 text-[13px] ${params.error ? "text-[var(--warn)]" : "text-[var(--fg)]"}`}
        >
          {banner}
        </div>
      ) : null}
      <div className="mt-6">
        <AuthForm mode="sign-in" next={params.next} googleEnabled={isGoogleAuthEnabled()} />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        New to Sifty?{" "}
        <Link href="/sign-up" className="text-[var(--accent)] hover:underline">
          Create an account
        </Link>
      </div>
    </div>
  );
}
