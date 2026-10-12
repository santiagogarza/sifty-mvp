import { getSession } from "@/lib/auth/session";
import { connectorErrorResponse } from "@/lib/connectors/http";
import { PRO_REQUIRED_MESSAGE, listConnectionViews } from "@/lib/connectors/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every provider with the signed-in user's connection state. Never
 * includes tokens or sealed secrets; the row's reference fields only.
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const result = await listConnectionViews(session.user.id, {
      isCreator: session.user.isCreator,
    });
    return NextResponse.json({
      ...result,
      proRequiredMessage: result.allowed ? null : PRO_REQUIRED_MESSAGE,
    });
  } catch (err) {
    return connectorErrorResponse(err, "connectors.list");
  }
}
