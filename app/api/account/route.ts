import { AccountDeletionError, deleteAccount } from "@/lib/auth/account";
import { SESSION_COOKIE_NAME, getSession } from "@/lib/auth/session";
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
    const stage = err instanceof AccountDeletionError ? err.stage : "database";
    reportError(err, { area: "account.delete", userId: session.user.id, tags: { stage } });
    if (stage === "billing") {
      return NextResponse.json(
        { error: "Couldn't cancel billing for this account. Nothing was deleted; try again." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Billing was cancelled but the account couldn't be removed. Try again; nothing will be charged.",
      },
      { status: 500 },
    );
  }
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = NextResponse.json({ ok: true, stripeCustomer: result.stripeCustomer });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
