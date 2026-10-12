import { NextResponse } from "next/server";
import { type Session, getSession } from "./session";

/**
 * Admin surfaces (cost view, workflow ping) are for the creator account
 * only. Non-creators get a 404, not a 403: the routes should not advertise
 * themselves. The auth-bypass session is the creator by default
 * (`SIFTY_USER_EMAIL` falls back to `CREATOR_EMAIL`), so local dev works.
 */
export type CreatorGate = { ok: true; session: Session } | { ok: false; response: NextResponse };

export async function requireCreator(req?: Request): Promise<CreatorGate> {
  const session = await getSession(req);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  if (!session.user.isCreator) {
    return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true, session };
}
