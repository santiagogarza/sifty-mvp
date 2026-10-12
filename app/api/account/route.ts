import { AccountDeletionError, CreatorAccountError, deleteAccount } from "@/lib/auth/account";
import { sessionCookieNames } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  /** The account email, typed by the user. Case-insensitive. */
  confirmEmail: z.string().min(1).max(320),
});

/**
 * Delete the signed-in account: Stripe customer (when one exists), then
 * every row the user owns. Requires the user to retype their email so a
 * stray click cannot do it, and is unavailable in auth-bypass mode where
 * the "account" is a process-wide bootstrap row.
 */
export async function DELETE(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.sessionId === null) {
    return NextResponse.json(
      { error: "Account deletion is not available with SIFTY_DISABLE_AUTH." },
      { status: 400 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  if (parsed.data.confirmEmail.trim().toLowerCase() !== session.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "The email you typed does not match this account." },
      { status: 400 },
    );
  }

  let result: Awaited<ReturnType<typeof deleteAccount>>;
  try {
    result = await deleteAccount(getRepos(), session.user.id);
  } catch (err) {
    if (err instanceof CreatorAccountError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const failure = err instanceof AccountDeletionError ? err : null;
    reportError(err, {
      area: "account.delete",
      userId: session.user.id,
      tags: { stage: failure?.stage ?? "unknown", stripeCustomer: failure?.stripeCustomer },
    });
    if (failure?.stage === "billing") {
      return NextResponse.json(
        { error: "Couldn't cancel billing for this account. Nothing was deleted; try again." },
        { status: 502 },
      );
    }
    // Only say billing is gone when Stripe actually removed the customer.
    const error =
      failure?.stripeCustomer === "deleted"
        ? "Billing was cancelled but the account couldn't be removed. Try again; nothing will be charged."
        : "Couldn't delete the account. Nothing was changed; try again.";
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = NextResponse.json({ ok: true, stripeCustomer: result.stripeCustomer });
  // The sessions are gone server-side; expire the browser's copies too.
  for (const cookie of await sessionCookieNames()) {
    res.cookies.set(cookie.name, "", {
      httpOnly: cookie.attributes.httpOnly ?? true,
      secure: cookie.attributes.secure ?? false,
      sameSite: "lax",
      path: cookie.attributes.path ?? "/",
      maxAge: 0,
    });
  }
  return res;
}
