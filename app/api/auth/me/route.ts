import { getSession } from "@/lib/auth/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Who am I. The sync layer calls this before pulling so it can detect an
 * account switch on a shared browser and reset the local cache instead of
 * replaying the previous user's tasks into the new account.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({
    user: session.user,
    authBypass: session.sessionId === null,
  });
}
