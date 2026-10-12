import { resolveOfflineMode } from "@/lib/ai/ai-gate";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { EXECUTION_LIMITS } from "@/lib/domain/limits";
import { EXECUTION_POLICIES, EXECUTOR_KINDS } from "@/lib/domain/types";
import { enqueueExecution } from "@/lib/executions/service";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { TRIAGE_IP_POLICY, TRIAGE_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z
  .object({
    executor: z.enum(EXECUTOR_KINDS).optional(),
    policy: z.enum(EXECUTION_POLICIES).optional(),
    /** Client-generated per click; a retry of the same click reuses it. */
    idempotencyKey: z.string().min(1).max(EXECUTION_LIMITS.idempotencyKey).optional(),
    modelPreference: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * "Run now": hand the task to an executor. 202 with the execution (status
 * `queued`, or `needs_approval` once the run parks) — the client polls
 * `GET /api/executions/:id`. 402 for a tier without execution or a used
 * up monthly budget, 409 when the task already has a live execution, 200
 * with `created: false` when the idempotency key was seen before.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const limited = await enforceRateLimit(req, {
    route: "execute",
    ip: TRIAGE_IP_POLICY,
    message: "Too many requests. Slow down a bit.",
  });
  if (!limited.ok) return limited.response;

  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const perUser = await enforceRateLimit(req, {
    route: "execute",
    subject: { id: session.user.id, policy: TRIAGE_POLICY },
    message: "Too many requests. Slow down a bit.",
  });
  if (!perUser.ok) return perUser.response;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const repos = getRepos();
  const task = await repos.tasks.get(session.user.id, id);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await enqueueExecution({
    session,
    task,
    executor: parsed.data.executor,
    policy: parsed.data.policy ?? null,
    idempotencyKey: parsed.data.idempotencyKey ?? null,
    offline: resolveOfflineMode(req),
    modelPreference: parsed.data.modelPreference ?? null,
    repos,
  });

  if (result.ok) {
    return NextResponse.json(
      {
        execution: result.execution,
        created: result.created,
        policy: result.policy,
        runId: result.runId,
      },
      { status: result.created ? 202 : 200 },
    );
  }
  switch (result.reason) {
    case "executor_unavailable":
      return NextResponse.json(
        { error: `The ${result.executor} executor is not available yet.`, code: result.reason },
        { status: 400 },
      );
    case "denied":
      return NextResponse.json(
        { error: result.message, code: result.code, execution: result.execution },
        { status: 402 },
      );
    case "already_running":
      return NextResponse.json(
        {
          error: "Sifty is already working on this task.",
          code: result.reason,
          execution: result.execution,
        },
        { status: 409 },
      );
    case "not_started":
      return NextResponse.json(
        { error: result.execution.error, code: result.reason, execution: result.execution },
        { status: 503 },
      );
  }
}
