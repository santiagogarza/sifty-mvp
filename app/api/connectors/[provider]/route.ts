import { getSession } from "@/lib/auth/session";
import { connectorErrorResponse, parseProvider } from "@/lib/connectors/http";
import { checkConnection, disconnect } from "@/lib/connectors/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

/** Health check: asks the broker whether the grant still works and records the answer. */
export async function POST(req: Request, ctx: RouteContext) {
  const { provider: raw } = await ctx.params;
  const provider = parseProvider(raw);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const row = await checkConnection(session.user.id, provider);
    return NextResponse.json({
      status: row.status,
      lastCheckedAt: row.lastCheckedAt,
      lastError: row.lastError,
    });
  } catch (err) {
    return connectorErrorResponse(err, "connectors.check");
  }
}

/** Disconnect: revoke at the broker (best effort) and drop the row. */
export async function DELETE(req: Request, ctx: RouteContext) {
  const { provider: raw } = await ctx.params;
  const provider = parseProvider(raw);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const removed = await disconnect(session.user.id, provider);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return connectorErrorResponse(err, "connectors.disconnect");
  }
}
