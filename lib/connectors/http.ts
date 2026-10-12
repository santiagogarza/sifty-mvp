import { type ConnectorProvider, isConnectorProvider } from "@/lib/db/repos/types";
import { isVercelProduction } from "@/lib/env/production-guards";
import { reportError } from "@/lib/observability/report-error";
import { getSiteUrl } from "@/lib/site/config";
import { NextResponse } from "next/server";
import { ConnectorError } from "./service";

/** Route-layer helpers shared by `/api/connectors/*`. */

export function parseProvider(raw: string): ConnectorProvider | null {
  return isConnectorProvider(raw) ? raw : null;
}

/**
 * Origin for the callback URL. Production always uses the canonical URL
 * (what the connector was registered with); previews and local dev use
 * the request's own origin so the browser lands back where it started.
 */
export function callbackOrigin(req: Request): string {
  if (isVercelProduction()) return getSiteUrl();
  return new URL(req.url).origin;
}

export function connectorErrorResponse(err: unknown, area: string): NextResponse {
  if (err instanceof ConnectorError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  reportError(err, { area });
  return NextResponse.json({ error: "Something went wrong with the connection." }, { status: 500 });
}
