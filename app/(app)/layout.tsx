import { AppFrame } from "@/components/app-shell/app-frame";
import { getSession } from "@/lib/auth/session";
import { headers } from "next/headers";
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
  if (!session) {
    const path = (await headers()).get("x-sifty-path");
    redirect(path ? `/sign-in?next=${encodeURIComponent(path)}` : "/sign-in");
  }
  return <AppFrame>{children}</AppFrame>;
}
