import { checkHealth } from "@/lib/observability/health";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uptime probe. 200 when healthy, 503 otherwise; never cached. */
export async function GET() {
  const report = await checkHealth();
  return NextResponse.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
