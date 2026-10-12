import { type EnqueueResult, enqueueSift } from "@/lib/ai/sift/enqueue";
import { withAnswer } from "@/lib/ai/sift/execute-stage";
import type { Session } from "@/lib/auth/session";
import { type Repos, getRepos } from "@/lib/db/repos";
import type { Decision, DecisionAnswer, Task } from "@/lib/domain/types";
import { answerText, resolveDecision } from "./service";

/**
 * What answering or dismissing a decision does to the thing it is about.
 * Shared by the app routes (session) and the one-tap link route (token),
 * so both paths behave identically.
 *
 * Clarifying questions resume the sift that asked. When that run is gone
 * (deploy, deadline, failure) the answer is folded into the capture here
 * and a fresh sift is enqueued, so the user's answer is never silently
 * dropped; that fallback is a new sift and counts as one.
 */

export type AnswerMode =
  /** The suspended run woke up and is folding the answer in. */
  | "resumed"
  /** No run was waiting: the answer was folded in and a new sift started. */
  | "resifted"
  /** Recorded on the decision only (task gone, or a kind with no follow-up). */
  | "recorded";

export type AnswerResult =
  | {
      ok: true;
      decision: Decision;
      task: Task | null;
      mode: AnswerMode;
      sift: EnqueueResult | null;
    }
  | { ok: false; reason: "not_found" | "already_resolved"; decision: Decision | null };

export async function answerDecision(args: {
  req: Request;
  session: Session;
  decisionId: string;
  answer: DecisionAnswer;
  modelPreference: string | null;
  offline: boolean;
  repos?: Repos;
}): Promise<AnswerResult> {
  const repos = args.repos ?? getRepos();
  const userId = args.session.user.id;
  const resolved = await resolveDecision(
    userId,
    args.decisionId,
    { status: "answered", answer: args.answer },
    repos,
  );
  if (!resolved.ok) return resolved;
  const { decision, resumed } = resolved;
  const payload = decision.payload;

  if (payload.kind !== "clarifying_question" || !decision.taskId) {
    return { ok: true, decision, task: null, mode: "recorded", sift: null };
  }
  const task = await repos.tasks.get(userId, decision.taskId);
  if (!task) return { ok: true, decision, task: null, mode: "recorded", sift: null };

  if (resumed) {
    // The fold step flips the task to `running`; mark it `pending` now so a
    // watcher that polls before the run gets compute sees movement.
    const pending = await repos.tasks.update(
      userId,
      task.id,
      { aiStatus: "pending", aiError: null, siftStage: null, clarifyingQuestion: null },
      { ifSiftId: payload.siftId },
    );
    return { ok: true, decision, task: pending ?? task, mode: "resumed", sift: null };
  }

  const folded =
    (await repos.tasks.update(userId, task.id, {
      sourceContext: withAnswer(task.sourceContext, answerText(args.answer)),
      clarifyingQuestion: null,
      siftedWithAssumptions: false,
    })) ?? task;
  const sift = await enqueueSift({
    req: args.req,
    session: args.session,
    task: folded,
    modelPreference: args.modelPreference,
    offline: args.offline,
  });
  return { ok: true, decision, task: sift.task, mode: "resifted", sift };
}

export type DismissResult =
  | { ok: true; decision: Decision; task: Task | null }
  | { ok: false; reason: "not_found" | "already_resolved"; decision: Decision | null };

export async function dismissDecision(args: {
  userId: string;
  decisionId: string;
  repos?: Repos;
}): Promise<DismissResult> {
  const repos = args.repos ?? getRepos();
  const resolved = await resolveDecision(
    args.userId,
    args.decisionId,
    { status: "dismissed", answer: null },
    repos,
  );
  if (!resolved.ok) return resolved;
  const { decision } = resolved;
  const payload = decision.payload;
  if (payload.kind !== "clarifying_question" || !decision.taskId) {
    return { ok: true, decision, task: null };
  }
  // Only while the asking sift still owns the task: a newer sift has its
  // own view and must not inherit "assumptions" from a question it never
  // asked.
  const task =
    (await repos.tasks.update(
      args.userId,
      decision.taskId,
      { clarifyingQuestion: null, siftedWithAssumptions: true },
      { ifSiftId: payload.siftId },
    )) ?? (await repos.tasks.get(args.userId, decision.taskId));
  return { ok: true, decision, task };
}
