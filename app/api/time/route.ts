import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The wall clock, straight from the server.
 *
 * Deliberately unauthenticated and body-free: it exposes nothing a `Date`
 * header wouldn't, and the focus timer needs it before anything else has
 * loaded. Clients use it to correct for a skewed local clock so a pomodoro
 * measures 25 real minutes.
 */
export function GET(): NextResponse {
  const now = Date.now();
  return NextResponse.json(
    { now, iso: new Date(now).toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
