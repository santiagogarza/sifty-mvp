import { type Repos, getRepos } from "@/lib/db/repos";
import type { DecisionResolution } from "@/lib/db/repos/types";
import type { ClarifyingQuestionPayload, Decision, DecisionAnswer } from "@/lib/domain/types";
import { reportError } from "@/lib/observability/report-error";
import { resumeWorkflowHook } from "@/lib/workflows/dispatch";
import { DECISION_TTL_MS, type DecisionResolutionPayload, decisionHookToken } from "./hook";

/**
 * Decisions service: the one place that opens, lists, and resolves
 * decisions and talks to the workflow hook behind each one.
 *
 * Resolution is a compare-and-set in the repository (`open` → terminal),
 * then a best-effort hook resume. The repository write is the truth: a
 * decision whose run has already ended still counts as answered, and the
 * caller gets `resumed: false` so it can fall back to re-running the work.
 */

export { DECISION_TTL_MS, decisionHookToken };
export type { DecisionResolutionPayload };

/** Default bound for `listOpen`; the inbox shows at most this many. */
export const OPEN_DECISIONS_LIMIT = 50;
/** A task carries at most one open question per sift; this is headroom, not a target. */
const OPEN_PER_TASK_LIMIT = 10;

/**
 * Open decisions newest first, at most `limit` (default
 * `OPEN_DECISIONS_LIMIT`). Stable export consumed by the notifications
 * worker for the "waiting on you" section of digests and pushes.
 */
export async function listOpen(userId: string, opts: { limit?: number } = {}): Promise<Decision[]> {
  return getRepos().decisions.listOpen(userId, { limit: opts.limit ?? OPEN_DECISIONS_LIMIT });
}

export async function openClarifyingQuestion(
  repos: Repos,
  userId: string,
  input: {
    id: string;
    taskId: string;
    siftId: string;
    question: string;
    options: string[];
    confidence: number;
    now?: Date;
  },
): Promise<Decision> {
  const now = input.now ?? new Date();
  const payload: ClarifyingQuestionPayload = {
    kind: "clarifying_question",
    question: input.question,
    options: input.options,
    siftId: input.siftId,
    confidence: input.confidence,
  };
  return repos.decisions.create(userId, {
    id: input.id,
    kind: "clarifying_question",
    taskId: input.taskId,
    payload,
    resumeToken: decisionHookToken(input.id),
    expiresAt: new Date(now.getTime() + DECISION_TTL_MS).toISOString(),
  });
}

export type ResolveResult =
  | { ok: true; decision: Decision; resumed: boolean }
  | { ok: false; reason: "not_found" | "already_resolved"; decision: Decision | null };

/**
 * Resolve an open decision and, unless `wake` is false, wake the run
 * waiting on it. Two concurrent resolutions (two tabs, a link and the app)
 * cannot both succeed: the repository CAS admits one and the other sees
 * `already_resolved`. Callers that must write something *before* the run
 * moves (an answer onto the task) pass `wake: false` and call
 * `wakeDecisionRun` themselves.
 */
export async function resolveDecision(
  userId: string,
  id: string,
  input: { status: DecisionResolution; answer: DecisionAnswer | null; wake?: boolean },
  repos: Repos = getRepos(),
): Promise<ResolveResult> {
  const resolved = await repos.decisions.resolve(userId, id, {
    status: input.status,
    answer: input.answer,
  });
  if (!resolved) {
    const current = await repos.decisions.get(userId, id);
    return { ok: false, reason: current ? "already_resolved" : "not_found", decision: current };
  }
  const resumed = input.wake === false ? false : await wakeDecisionRun(userId, resolved);
  return { ok: true, decision: resolved, resumed };
}

/** Deliver a resolved decision to the run suspended on it; true when one received it. */
export function wakeDecisionRun(userId: string, decision: Decision): Promise<boolean> {
  return wakeRun(userId, decision, payloadFor(decision));
}

function payloadFor(decision: Decision): DecisionResolutionPayload {
  if (decision.status === "answered" && decision.answer) {
    return { status: "answered", answer: decision.answer };
  }
  return { status: decision.status === "dismissed" ? "dismissed" : "expired" };
}

/**
 * A decision the run no longer needs an answer to: a re-sift took the task
 * over, or the task was deleted. Marks every open decision on the task
 * `expired` and releases the runs suspended on them so they can end.
 */
export async function expireOpenDecisionsForTask(
  repos: Repos,
  userId: string,
  taskId: string,
): Promise<number> {
  const open = await repos.decisions.listOpenForTask(userId, taskId, {
    limit: OPEN_PER_TASK_LIMIT,
  });
  let expired = 0;
  for (const decision of open) {
    // Only what the sift asked. A memory proposal is about the user, not
    // the run, and must survive a re-sift or a delete of the task it
    // happened to come from.
    if (decision.payload.kind !== "clarifying_question") continue;
    const resolved = await repos.decisions.resolve(userId, decision.id, {
      status: "expired",
      answer: null,
    });
    if (!resolved) continue;
    expired += 1;
    await wakeRun(userId, resolved, { status: "expired" });
  }
  return expired;
}

/**
 * Best effort: the run may have ended (deploy, 7-day deadline, failure).
 * Returns whether a run actually received the payload.
 */
async function wakeRun(
  userId: string,
  decision: Decision,
  payload: DecisionResolutionPayload,
): Promise<boolean> {
  if (!decision.resumeToken) return false;
  try {
    const outcome = await resumeWorkflowHook(decision.resumeToken, payload);
    return outcome.ok;
  } catch (err) {
    reportError(err, {
      area: "decisions.resume",
      userId,
      tags: { decisionId: decision.id, status: decision.status },
    });
    return false;
  }
}

/** Trim and bound a free-text answer; null when empty. */
export function normalizeAnswer(input: {
  text?: string | null;
  option?: string | null;
  draft?: { title?: string | null; body: string } | null;
  via: DecisionAnswer["via"];
}): DecisionAnswer | null {
  const text = input.text?.trim() || null;
  const option = input.option?.trim() || null;
  if (!text && !option) return null;
  const answer: DecisionAnswer = { text, option, via: input.via };
  if (input.draft?.body.trim()) {
    answer.draft = {
      title: input.draft.title?.trim() || null,
      body: input.draft.body,
      format: "markdown",
    };
  }
  return answer;
}

/** The answer as one line for prompts and `sourceContext`. */
export function answerText(answer: DecisionAnswer): string {
  if (answer.option && answer.text) return `${answer.option} — ${answer.text}`;
  return answer.option ?? answer.text ?? "";
}
