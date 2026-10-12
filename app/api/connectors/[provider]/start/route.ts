import { getSession } from "@/lib/auth/session";
import { callbackOrigin, connectorErrorResponse, parseProvider } from "@/lib/connectors/http";
import { startConnect } from "@/lib/connectors/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

/**
 * Begin a connection. Returns the consent URL as JSON (the client
 * navigates) so a failed start shows an error in place instead of a
 * broken redirect. 402 when the tier does not include connectors, 503
 * when the operator has not configured the provider.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const { provider: raw } = await ctx.params;
  const provider = parseProvider(raw);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { url } = await startConnect(session.user.id, provider, { origin: callbackOrigin(req) });
    return NextResponse.json({ url });
  } catch (err) {
    return connectorErrorResponse(err, "connectors.start");
  }
}
