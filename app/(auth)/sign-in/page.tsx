import { AuthForm } from "@/components/auth/auth-form";
import Link from "next/link";

export const metadata = { title: "Sign in to Sifty" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = (await searchParams) ?? {};
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Welcome back</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">Sign in to your Sifty account.</p>
      <div className="mt-6">
        <AuthForm mode="sign-in" next={params.next} />
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
