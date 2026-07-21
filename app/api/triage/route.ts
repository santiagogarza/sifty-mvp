import { gateAiRequest, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { recordAiRun } from "@/lib/ai/ai-runs";
import { applyTriageToTask } from "@/lib/ai/apply-triage";
import { MissingAiKeyError, triageTask } from "@/lib/ai/triage-agent";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  taskId: z.string().min(1).max(64).optional(),
  sourceText: z.string().min(1).max(4000),
  sourceContext: z.string().max(8000).nullable().optional(),
  recentLabels: z.array(z.string()).max(20).optional(),
  preferences: z.array(z.string()).max(20).optional(),
  modelId: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const offline = resolveOfflineMode(req);

  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const gate = await gateAiRequest({ req, session, bucket: "triage" });
  if (!gate.ok) return gate.response;

  try {
    const result = await triageTask({
      sourceText: parsed.data.sourceText,
      sourceContext: parsed.data.sourceContext ?? null,
      recentLabels: parsed.data.recentLabels,
      preferences: parsed.data.preferences,
      modelId: parsed.data.modelId,
      offline,
    });

    // Persist the result to the task so it survives a client disconnect.
    // Best-effort: when the task hasn't reached the server yet the client
    // applies locally and the sync layer reconciles later.
    let applied = null;
    if (parsed.data.taskId) {
      applied = await applyTriageToTask(
        getRepos(),
        session.user.id,
        parsed.data.taskId,
        result.output,
      ).catch((err) => {
        reportError(err, {
          area: "triage.apply",
          userId: session.user.id,
          tags: { taskId: parsed.data.taskId ?? null },
        });
        return null;
      });
    }

    await recordAiRun({
      userId: session.user.id,
      taskId: parsed.data.taskId ?? null,
      meta: result.meta,
      status: "succeeded",
    });

    return NextResponse.json({
      ...result,
      task: applied?.task ?? null,
      labels: applied?.labels ?? [],
    });
  } catch (err) {
    if (err instanceof MissingAiKeyError) {
      return NextResponse.json(
        {
          error:
            "No AI provider key is configured. Set AI_GATEWAY_API_KEY (or a provider-specific key) and reload.",
          code: "no_ai_key",
        },
        { status: 503 },
      );
    }

    const message = err instanceof Error ? err.message : "Triage failed";
    reportError(err, {
      area: "triage.route",
      userId: session.user.id,
      tags: { modelId: parsed.data.modelId ?? null, offline },
    });
    await recordAiRun({
      userId: session.user.id,
      taskId: parsed.data.taskId ?? null,
      meta: {
        promptVersion: "triage.v1",
        model: parsed.data.modelId ?? "unknown",
        transport: "unknown",
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        costCents: null,
        offline,
      },
      status: "failed",
      error: message,
    });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
