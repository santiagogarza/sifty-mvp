import { gateAiRequestByIp, resolveOfflineMode } from "@/lib/ai/ai-gate";
import { enqueueSift } from "@/lib/ai/sift/enqueue";
import { getSession } from "@/lib/auth/session";
import { getRepos } from "@/lib/db/repos";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

/**
 * "Re-sift now."
 *
 * Sifting runs server-side when a task is created (`POST /api/tasks`); this
 * route re-runs the whole pipeline on an existing task — the retry button,
 * or a deliberate re-sift after the user added context. It answers 202 with
 * the task in `pending` state; progress is read from `GET /api/tasks/:id`.
 *
 * The new sift takes over `task.siftId`, so a run still in flight stops at
 * its next step instead of racing this one. User-edited fields stay
 * protected exactly as before (`editedFields`).
 */
const Body = z.object({
  taskId: z.string().min(1).max(64),
  /** Settings → AI model preference id. Unknown values fall back to the stage default. */
  modelPreference: z.string().min(1).max(64).optional(),
  /** Pre-registry clients sent a raw model id here; still accepted as a preference. */
  modelId: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const ipGate = await gateAiRequestByIp(req, "triage");
  if (!ipGate.ok) return ipGate.response;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const task = await getRepos().tasks.get(session.user.id, parsed.data.taskId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await enqueueSift({
    req,
    session,
    task,
    modelPreference: parsed.data.modelPreference ?? parsed.data.modelId ?? null,
    offline: resolveOfflineMode(req),
  });

  if (result.ok) {
    return NextResponse.json(
      { task: result.task, siftId: result.siftId, runId: result.runId },
      { status: 202 },
    );
  }
  if (result.reason === "denied") {
    return NextResponse.json(
      { ...result.admission.body, task: result.task },
      { status: result.admission.status, headers: result.admission.headers },
    );
  }
  if (result.reason === "already_sifting") {
    // A concurrent re-sift won the claim; its run is the one to watch.
    return NextResponse.json(
      { task: result.task, siftId: result.task.siftId, runId: null },
      { status: 202 },
    );
  }
  return NextResponse.json(
    { error: "Sifting could not start — try again.", task: result.task },
    { status: 503 },
  );
}
