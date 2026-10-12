import { AppFrame } from "@/components/app-shell/app-frame";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

/**
 * Authoritative gate for the signed-in app. The middleware only checks that
 * a session cookie exists; this validates it against the session table (or
 * yields the bypass session under `SIFTY_DISABLE_AUTH=1`).
 *
 * Must be dynamic: a prerender has no cookies and would bake the redirect
 * into the static page.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return <AppFrame>{children}</AppFrame>;
}
