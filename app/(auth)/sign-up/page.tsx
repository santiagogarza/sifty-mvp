import { AuthForm } from "@/components/auth/auth-form";
import Link from "next/link";

export const metadata = { title: "Create a Sifty account" };

export default function SignUpPage() {
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Create your account</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">
        Start your 30-day trial. No card up front.
      </p>
      <div className="mt-6">
        <AuthForm mode="sign-up" />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}
