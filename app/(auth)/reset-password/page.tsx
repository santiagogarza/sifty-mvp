import { ResetPasswordForm } from "@/components/auth/password-forms";
import Link from "next/link";

export const metadata = { title: "Choose a new Sifty password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const invalid = !params.token || !!params.error;
  return (
    <div className="surface-card p-7">
      <h1 className="text-[20px] tracking-[-0.01em] text-[var(--fg)]">Choose a new password</h1>
      {invalid ? (
        <>
          <p role="alert" className="text-[13.5px] text-[var(--warn)] mt-2">
            This reset link has expired or was already used.
          </p>
          <div className="mt-6 text-[13px] text-[var(--fg-muted)]">
            <Link href="/forgot-password" className="text-[var(--accent)] hover:underline">
              Request a new link
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">
            Other devices will be signed out once you save it.
          </p>
          <div className="mt-6">
            <ResetPasswordForm token={params.token!} />
          </div>
        </>
      )}
    </div>
  );
}
