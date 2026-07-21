import { BRIEF_PROMPT_VERSION, generateAgentBrief } from "@/lib/ai/agent-brief";
import { gateAiRequest, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { recordAiRun } from "@/lib/ai/ai-runs";
import { MissingAiKeyError } from "@/lib/ai/provider";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  taskId: z.string().min(1).max(64),
  modelId: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const gate = await gateAiRequest({ req, session, bucket: "brief" });
  if (!gate.ok) return gate.response;

  const repos = getRepos();
  const task = await repos.tasks.get(session.user.id, parsed.data.taskId);
  if (!task) {
    return NextResponse.json(
      { error: "Task not found on the server yet. Try again in a moment." },
      { status: 404 },
    );
  }

  const offline = resolveOfflineMode(req);
  const [allLabels, memories] = await Promise.all([
    repos.labels.list(session.user.id),
    repos.memories.list(session.user.id),
  ]);
  const labelNames = allLabels.filter((l) => task.labelIds.includes(l.id)).map((l) => l.name);
  const preferences = memories.filter((m) => m.pinned).map((m) => m.text);

  try {
    const result = await generateAgentBrief({
      task,
      labelNames,
      preferences,
      modelId: parsed.data.modelId,
      offline,
    });

    const updated = await repos.tasks.update(session.user.id, task.id, {
      agentBrief: result.markdown,
    });

    await recordAiRun({
      userId: session.user.id,
      taskId: task.id,
      meta: result.meta,
      status: "succeeded",
    });

    return NextResponse.json({ brief: result.markdown, task: updated });
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
    // Full detail goes to the error reporter and the ai_runs record; the
    // client gets a stable, provider-free message.
    const message = err instanceof Error ? err.message : "Brief generation failed";
    reportError(err, {
      area: "agent-brief.route",
      userId: session.user.id,
      tags: { taskId: task.id },
    });
    await recordAiRun({
      userId: session.user.id,
      taskId: task.id,
      meta: {
        promptVersion: BRIEF_PROMPT_VERSION,
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
    return NextResponse.json({ error: "Brief generation failed — try again." }, { status: 500 });
  }
}
