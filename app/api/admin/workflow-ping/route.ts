import { requireCreator } from "@/lib/auth/require-creator";
import { reportError } from "@/lib/observability/report-error";
import { startWorkflow, waitForRun } from "@/lib/workflows/dispatch";
import { pingWorkflow } from "@/lib/workflows/ping";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long to wait for the ping to finish before answering `pending`. */
const WAIT_MS = 20_000;
/** `?hold=<ms>` keeps the slot busy so a second ping visibly waits; capped. */
const MAX_HOLD_MS = 15_000;

/**
 * Creator-only smoke test for the Workflow runtime on this deployment.
 *
 *   curl -X POST https://<host>/api/admin/workflow-ping -H "cookie: …"
 *
 * `completed` proves the queue trigger, the flow route, and run storage all
 * work (on Vercel: that the plan allows Workflow and system env vars are
 * on). `pending` after 20 s means the run was accepted but nothing picked
 * it up; `failed` carries the runtime's message. Either way the run id can
 * be inspected with `pnpm workflow:runs` (locally) or in the Vercel
 * dashboard → Workflows.
 */
export async function POST(req: Request) {
  const gate = await requireCreator(req);
  if (!gate.ok) return gate.response;

  const echo = `ping-${Date.now().toString(36)}`;
  const holdParam = Number(new URL(req.url).searchParams.get("hold") ?? 0);
  const holdMs = Number.isFinite(holdParam) ? Math.min(Math.max(holdParam, 0), MAX_HOLD_MS) : 0;
  try {
    const { runId } = await startWorkflow(pingWorkflow, [gate.session.user.id, echo, holdMs]);
    const outcome = await waitForRun(runId, WAIT_MS);
    return NextResponse.json({ runId, echo, ...outcome });
  } catch (err) {
    reportError(err, { area: "workflow.ping", userId: gate.session.user.id });
    return NextResponse.json(
      {
        error: "Workflow could not be started on this deployment.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
