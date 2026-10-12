import { memoryFromProposal } from "@/lib/ai/memory/propose";
import { type EnqueueResult, enqueueSift } from "@/lib/ai/sift/enqueue";
import { withAnswer } from "@/lib/ai/sift/execute-stage";
import type { Session } from "@/lib/auth/session";
import { type Repos, getRepos } from "@/lib/db/repos";
import type { Decision, DecisionAnswer, Memory, Task } from "@/lib/domain/types";
import { REMEMBER_OPTION } from "./copy";
import { answerText, resolveDecision, wakeDecisionRun } from "./service";

/**
 * What answering or dismissing a decision does to the thing it is about.
 * Shared by the app routes (session) and the one-tap link route (token),
 * so both paths behave identically.
 *
 * Clarifying questions: the answer is written onto the task *first*, as an
 * `Answer:` line in the capture, conditional on the asking sift still
 * owning the task. Only then is the suspended run woken; its own fold step
 * is idempotent on that line. If the conditional write misses — a re-sift
 * claimed the task between the user reading the question and answering
 * it — or no run is waiting (deploy, deadline, failure), the answer is
 * folded in unconditionally and a fresh sift is enqueued, so the user's
 * answer is never silently dropped; that fallback is a new sift and counts
 * as one.
 */

export type AnswerMode =
  /** The suspended run woke up and is folding the answer in. */
  | "resumed"
  /** No run was waiting: the answer was folded in and a new sift started. */
  | "resifted"
  /** A memory proposal was confirmed and written to `memories`. */
  | "remembered"
  /** Recorded on the decision only (task gone, or a kind with no follow-up). */
  | "recorded";

export type AnswerResult =
  | {
      ok: true;
      decision: Decision;
      task: Task | null;
      mode: AnswerMode;
      sift: EnqueueResult | null;
      /** The pinned memory a confirmed proposal became; the client adopts it. */
      memory?: Memory | null;
    }
  | { ok: false; reason: "not_found" | "already_resolved"; decision: Decision | null }
  /** A memory proposal only takes `REMEMBER_OPTION`; anything else is a client bug. */
  | { ok: false; reason: "invalid_answer"; decision: Decision };

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

  // A memory proposal's confirmation *is* the write, so the memory goes in
  // before the row is resolved: a failed write leaves the proposal open to
  // retry, and the id derived from the decision makes a second tab's
  // write a no-op rather than a duplicate.
  const before = await repos.decisions.get(userId, args.decisionId);
  if (before?.status === "open" && before.payload.kind === "memory_proposal") {
    if (args.answer.option !== REMEMBER_OPTION) {
      return { ok: false, reason: "invalid_answer", decision: before };
    }
  }
  const memory =
    before?.status === "open" && before.payload.kind === "memory_proposal"
      ? memoryFromProposal(before)
      : null;
  const stored = memory ? await repos.memories.create(userId, memory) : null;

  const resolved = await resolveDecision(
    userId,
    args.decisionId,
    { status: "answered", answer: args.answer, wake: false },
    repos,
  );
  if (!resolved.ok) {
    // Lost the CAS. If the other side confirmed, the memory is theirs to
    // keep; if it dismissed (or the row expired), take back what we wrote.
    if (memory && resolved.decision?.status !== "answered") {
      await repos.memories.delete(userId, memory.id);
    }
    return resolved;
  }
  const { decision } = resolved;
  const payload = decision.payload;

  if (payload.kind === "memory_proposal") {
    return { ok: true, decision, task: null, mode: "remembered", sift: null, memory: stored };
  }
  if (payload.kind !== "clarifying_question" || !decision.taskId) {
    // Nothing is waiting on a kind without follow-up work, but wake anyway
    // so a future kind's run is not left suspended.
    await wakeDecisionRun(userId, decision);
    return { ok: true, decision, task: null, mode: "recorded", sift: null };
  }
  const task = await repos.tasks.get(userId, decision.taskId);
  if (!task) return { ok: true, decision, task: null, mode: "recorded", sift: null };

  const line = answerText(args.answer);
  // The answer lands on the task before anything else moves. `pending`
  // shows the watcher movement before the run gets compute; the run's own
  // fold step then flips it to `running`.
  const onAskingSift = await repos.tasks.update(
    userId,
    task.id,
    {
      sourceContext: withAnswer(task.sourceContext, line),
      clarifyingQuestion: null,
      siftedWithAssumptions: false,
      aiStatus: "pending",
      aiError: null,
      siftStage: null,
    },
    { ifSiftId: payload.siftId },
  );

  if (onAskingSift) {
    const resumed = await wakeDecisionRun(userId, decision);
    if (resumed) return { ok: true, decision, task: onAskingSift, mode: "resumed", sift: null };
    // No run to wake: the answer is on the task; a fresh sift reads it.
    const sift = await enqueueSift({
      req: args.req,
      session: args.session,
      task: onAskingSift,
      modelPreference: args.modelPreference,
      offline: args.offline,
    });
    return { ok: true, decision, task: sift.task, mode: "resifted", sift };
  }

  // A newer sift owns the task (re-sift between reading and answering).
  // That sift never saw the answer, so fold it in and supersede the run.
  const current = (await repos.tasks.get(userId, task.id)) ?? task;
  const folded =
    (await repos.tasks.update(userId, task.id, {
      sourceContext: withAnswer(current.sourceContext, line),
      clarifyingQuestion: null,
      siftedWithAssumptions: false,
    })) ?? current;
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
