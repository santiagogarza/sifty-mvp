import { AuthForm } from "@/components/auth/auth-form";
import { isGoogleAuthEnabled } from "@/lib/auth/auth";
import Link from "next/link";

export const metadata = { title: "Create a Sifty account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = (await searchParams) ?? {};
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Create your account</h1>
      <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">
        Start with 30 days of Pro. No card up front; Free afterwards.
      </p>
      <div className="mt-6">
        <AuthForm mode="sign-up" next={params.next} googleEnabled={isGoogleAuthEnabled()} />
      </div>
      <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
        Already have an account?{" "}
        <Link
          href={params.next ? `/sign-in?next=${encodeURIComponent(params.next)}` : "/sign-in"}
          className="text-[var(--accent)] hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
