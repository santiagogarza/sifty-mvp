import { ForgotPasswordForm } from "@/components/auth/password-forms";
import Link from "next/link";

export const metadata = { title: { absolute: "Reset your Sifty password" } };

export default function ForgotPasswordPage() {
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Forgot your password?</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">
        Enter your email and we will send you a link to choose a new one.
      </p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        <Link href="/sign-in" className="text-[var(--accent)] hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
