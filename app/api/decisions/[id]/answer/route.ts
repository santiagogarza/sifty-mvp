import { gateAiRequestByIp, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { getSession } from "@/lib/auth/session";
import { answerDecision } from "@/lib/decisions/actions";
import { normalizeAnswer } from "@/lib/decisions/service";
import { DECISION_LIMITS } from "@/lib/domain/limits";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const Body = z
  .object({
    text: z.string().max(DECISION_LIMITS.answerText).optional(),
    option: z.string().max(DECISION_LIMITS.option).optional(),
    modelPreference: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Answer a decision. For a clarifying question this wakes the sift that
 * asked (or, if that run is gone, folds the answer in and starts a new
 * sift — hence the AI rate limit). 409 when the decision was already
 * resolved: two tabs or a one-tap link got there first.
 */
export async function POST(req: Request, ctx: RouteContext) {
  const ipGate = await gateAiRequestByIp(req, "triage");
  if (!ipGate.ok) return ipGate.response;

  const { id } = await ctx.params;
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const answer = normalizeAnswer({ ...parsed.data, via: "app" });
  if (!answer) return NextResponse.json({ error: "Answer is empty" }, { status: 400 });

  const result = await answerDecision({
    req,
    session,
    decisionId: id,
    answer,
    modelPreference: parsed.data.modelPreference ?? null,
    offline: resolveOfflineMode(req),
  });
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.reason === "invalid_answer") {
      return NextResponse.json(
        { error: "A memory proposal is confirmed with Remember or dismissed." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Already resolved", decision: result.decision },
      { status: 409 },
    );
  }
  return NextResponse.json({
    decision: result.decision,
    task: result.task,
    mode: result.mode,
    sift: result.sift?.ok ? { runId: result.sift.runId } : null,
    memory: result.memory ?? null,
  });
}
