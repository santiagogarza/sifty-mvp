import { countAiRunsToday, recordAiRun } from "@/lib/ai/ai-runs";
import { MissingAiKeyError, triageTask } from "@/lib/ai/triage-agent";
import { getSession } from "@/lib/auth/session";
import { canRunAi, deriveEntitlement } from "@/lib/entitlements/entitlements";
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

  const url = new URL(req.url);
  const offline = url.searchParams.get("offline") === "1";

  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const aiRunsToday = await countAiRunsToday(session.user.id);
  const entitlement = deriveEntitlement({
    profile: session.user,
    trialStartedAt: session.trialStartedAt,
    subscriptionActive: session.subscriptionActive,
    aiRunsToday,
  });
  const allowed = canRunAi(entitlement);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason, entitlement }, { status: 402 });
  }

  try {
    const result = await triageTask({
      sourceText: parsed.data.sourceText,
      sourceContext: parsed.data.sourceContext ?? null,
      recentLabels: parsed.data.recentLabels,
      preferences: parsed.data.preferences,
      modelId: parsed.data.modelId,
      offline,
    });

    await recordAiRun({
      userId: session.user.id,
      taskId: parsed.data.taskId ?? null,
      meta: result.meta,
      status: "succeeded",
    });

    return NextResponse.json(result);
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
