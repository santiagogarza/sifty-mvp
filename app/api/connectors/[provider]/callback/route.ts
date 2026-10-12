import { getSession } from "@/lib/auth/session";
import { parseProvider } from "@/lib/connectors/http";
import { ConnectorError, completeConnect } from "@/lib/connectors/service";
import { reportError } from "@/lib/observability/report-error";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ provider: string }>;
}

const SETTINGS = "/settings/connections";

/**
 * Where the broker sends the browser after consent. Always redirects back
 * to Settings → Connections with `?connected=<provider>` or
 * `?error=<provider>:<reason>`, so the page — not this route — tells the
 * user what happened. Needs the Sifty session: the grant is confirmed for
 * the signed-in user's own subject, never for an id in the URL.
 */
export async function GET(req: Request, ctx: RouteContext) {
  const { provider: raw } = await ctx.params;
  const url = new URL(req.url);
  const provider = parseProvider(raw);
  if (!provider) return redirectTo(url, { error: `${raw}:unknown_provider` });

  const session = await getSession(req);
  if (!session) {
    const next = encodeURIComponent(`${url.pathname}${url.search}`);
    return NextResponse.redirect(new URL(`/sign-in?next=${next}`, url.origin));
  }

  try {
    const result = await completeConnect(session.user.id, provider, url.searchParams);
    if (result.ok) return redirectTo(url, { connected: provider });
    return redirectTo(url, { error: `${provider}:${result.reason}` });
  } catch (err) {
    if (err instanceof ConnectorError)
      return redirectTo(url, { error: `${provider}:${err.message}` });
    reportError(err, { area: "connectors.callback", userId: session.user.id, tags: { provider } });
    return redirectTo(url, { error: `${provider}:Something went wrong finishing the connection.` });
  }
}

function redirectTo(current: URL, params: Record<string, string>): NextResponse {
  const target = new URL(SETTINGS, current.origin);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return NextResponse.redirect(target, { status: 303 });
}
