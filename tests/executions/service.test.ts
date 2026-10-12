import type { Session } from "@/lib/auth/session";
import type { DecisionResolution } from "@/lib/db/repos/types";
import type { Decision, Execution, ExecutionDraft, Task } from "@/lib/domain/types";
import { PRO_EXECUTION_BUDGET_CENTS_MONTH, emptySnapshot } from "@/lib/entitlements/entitlements";
import { APPROVE_OPTION, REJECT_OPTION } from "@/lib/executions/copy";
import { researchExecutor, setExecutorForTesting } from "@/lib/executions/executors";
import {
  applyExecutionDecision,
  cancelExecution,
  cancelExecutionsForTask,
  enqueueExecution,
  openApprovalDecision,
  openDraftReviewDecision,
  resolveExecutionDecision,
} from "@/lib/executions/service";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

/**
 * The execution service against the in-memory repos with the workflow
 * client stubbed: enqueue (tier gate, idempotency, budget reservation),
 * cancellation, and the database side of resolving an approval.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

async function sessionFor(kind: "free" | "pro" | "creator"): Promise<Session> {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: `${kind}-${Math.random().toString(36).slice(2)}@example.com`,
    displayName: kind,
    isCreator: kind === "creator",
  });
  const entitlement =
    kind === "pro"
      ? { ...emptySnapshot(), tier: "pro" as const, subscriptionActive: true }
      : kind === "creator"
        ? { ...emptySnapshot(), tier: "creator" as const }
        : emptySnapshot();
  await repos.entitlements.upsert(user.id, entitlement);
  return { user, entitlement, sessionId: null };
}

async function taskFor(session: Session, text = "Research the lease renewal"): Promise<Task> {
  const repos = getTestRepos();
  const task = await repos.tasks.create(session.user.id, { sourceText: text, sourceContext: null });
  return (await repos.tasks.update(session.user.id, task.id, { title: text, aiStatus: "ready" }))!;
}

function enqueue(
  session: Session,
  task: Task,
  extra: Partial<Parameters<typeof enqueueExecution>[0]> = {},
) {
  return enqueueExecution({ session, task, offline: true, modelPreference: null, ...extra });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  client.start.mockReset().mockResolvedValue({ runId: "wrun_exec" });
  client.resume.mockReset().mockResolvedValue({ ok: true, runId: "wrun_exec" });
  setWorkflowClientForTesting(client);
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  setExecutorForTesting("research", null);
  vi.restoreAllMocks();
});

describe("enqueueExecution", () => {
  it("creates a queued execution, reserves the estimate, starts the workflow, and audits it", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.runId).toBe("wrun_exec");
    expect(result.policy).toEqual({
      policy: "draft_then_approve",
      source: "default",
      downgraded: null,
    });
    expect(result.execution).toMatchObject({
      status: "queued",
      executor: "research",
      policy: "draft_then_approve",
      reservedCents: 5,
      costCents: 0,
      workflowRunId: "wrun_exec",
      taskId: task.id,
    });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start.mock.calls[0]![1]).toEqual([
      {
        userId: session.user.id,
        executionId: result.execution.id,
        taskId: task.id,
        offline: true,
        modelPreference: null,
      },
    ]);
    const events = await getTestRepos().taskEvents.listForTask(session.user.id, task.id, 10);
    expect(events.map((e) => e.kind)).toEqual(["execution.queued"]);
    expect(events[0]!.payload).toMatchObject({
      executionId: result.execution.id,
      estimateCents: 5,
    });
    const usage = await getTestRepos().executions.monthlyUsage(session.user.id);
    expect(usage).toEqual({ committedCents: 0, reservedCents: 5 });
  });

  it("is idempotent on the key: a replay returns the first row and starts nothing", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const first = await enqueue(session, task, { idempotencyKey: "click-1" });
    const again = await enqueue(session, task, { idempotencyKey: "click-1" });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.created).toBe(false);
    expect(again.execution.id).toBe(first.execution.id);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(await getTestRepos().executions.monthlyUsage(session.user.id)).toEqual({
      committedCents: 0,
      reservedCents: 5,
    });
    // A replay after the row finished is still the same row, not a new run.
    await getTestRepos().executions.transition(session.user.id, first.execution.id, {
      from: ["queued"],
      to: "done",
    });
    const later = await enqueue(session, task, { idempotencyKey: "click-1" });
    expect(later.ok && !later.created && later.execution.status === "done").toBe(true);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("refuses a second live execution of the same task with a different key", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const first = await enqueue(session, task, { idempotencyKey: "a" });
    const second = await enqueue(session, task, { idempotencyKey: "b" });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "already_running" });
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("concurrent enqueues with different keys start one execution and reserve once", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((key) => enqueue(session, task, { idempotencyKey: key })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "already_running")).toHaveLength(3);
    expect(
      await getTestRepos().executions.listForTask(session.user.id, task.id, { limit: 10 }),
    ).toHaveLength(1);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("free tier is refused before any row exists", async () => {
    const session = await sessionFor("free");
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    expect(result).toMatchObject({
      ok: false,
      reason: "denied",
      code: "execution_pro",
      execution: null,
    });
    expect(
      await getTestRepos().executions.listForTask(session.user.id, task.id, { limit: 5 }),
    ).toEqual([]);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("the monthly budget: exactly at the cap passes, one cent over is refused and recorded", async () => {
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    // Spend the whole budget but the executor's estimate.
    const spent = await taskFor(session, "spent");
    const earlier = await repos.executions.create(session.user.id, {
      taskId: spent.id,
      executor: "research",
      policy: "auto",
      connector: null,
      idempotencyKey: "earlier",
    });
    await repos.executions.transition(session.user.id, earlier.execution.id, {
      from: ["queued"],
      to: "done",
    });
    await repos.executions.settle(session.user.id, earlier.execution.id, {
      costCents: PRO_EXECUTION_BUDGET_CENTS_MONTH - 5,
    });

    const task = await taskFor(session);
    const atCap = await enqueue(session, task, { idempotencyKey: "at-cap" });
    expect(atCap.ok).toBe(true);
    expect(await repos.executions.monthlyUsage(session.user.id)).toEqual({
      committedCents: PRO_EXECUTION_BUDGET_CENTS_MONTH - 5,
      reservedCents: 5,
    });

    const other = await taskFor(session, "one more");
    const over = await enqueue(session, other, { idempotencyKey: "over" });
    expect(over).toMatchObject({ ok: false, reason: "denied", code: "execution_budget" });
    if (over.ok || over.reason !== "denied") return;
    expect(over.message).toMatch(/budget \(\$10\.00\) is used up/);
    expect(over.execution).toMatchObject({
      status: "failed",
      reservedCents: 0,
      error: over.message,
    });
    const events = await repos.taskEvents.listForTask(session.user.id, other.id, 10);
    expect(events.map((e) => e.kind).sort()).toEqual([
      "execution.budget_refused",
      "execution.queued",
    ]);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("a reservation is released when the run ends, and last month's spend does not count", async () => {
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    if (!result.ok) throw new Error("expected ok");
    const cancelled = await cancelExecution({
      userId: session.user.id,
      executionId: result.execution.id,
    });
    expect(cancelled.ok).toBe(true);
    expect(await repos.executions.monthlyUsage(session.user.id)).toEqual({
      committedCents: 0,
      reservedCents: 0,
    });
    // Spend recorded under last month's `createdAt` is invisible this month.
    const now = new Date("2026-10-12T12:00:00Z");
    const lastMonth = await taskFor(session, "september");
    const old = await repos.executions.create(session.user.id, {
      taskId: lastMonth.id,
      executor: "research",
      policy: "auto",
      connector: null,
      idempotencyKey: "sept",
    });
    await repos.executions.settle(session.user.id, old.execution.id, { costCents: 900 });
    const state = (
      repos as unknown as { __state: () => { executions: Map<string, Execution> } }
    ).__state();
    state.executions.get(old.execution.id)!.createdAt = "2026-09-30T23:59:00Z";
    expect(await repos.executions.monthlyUsage(session.user.id, now)).toEqual({
      committedCents: 0,
      reservedCents: 0,
    });
    expect(
      await repos.executions.monthlyUsage(session.user.id, new Date("2026-09-15T00:00:00Z")),
    ).toEqual({ committedCents: 900, reservedCents: 0 });
  });

  it("the creator's budget is unlimited", async () => {
    const session = await sessionFor("creator");
    const repos = getTestRepos();
    const spent = await taskFor(session, "spent");
    const big = await repos.executions.create(session.user.id, {
      taskId: spent.id,
      executor: "research",
      policy: "auto",
      connector: null,
      idempotencyKey: "big",
    });
    await repos.executions.settle(session.user.id, big.execution.id, { costCents: 10_000_000 });
    const task = await taskFor(session);
    expect((await enqueue(session, task)).ok).toBe(true);
  });

  it("auto on the read-only research executor is honoured; a side-effect executor is downgraded", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const auto = await enqueue(session, task, { policy: "auto", idempotencyKey: "auto" });
    expect(auto.ok && auto.execution.policy === "auto").toBe(true);

    setExecutorForTesting("research", { ...researchExecutor, readOnly: false });
    const other = await taskFor(session, "send it");
    const downgraded = await enqueue(session, other, { policy: "auto", idempotencyKey: "auto-2" });
    expect(downgraded.ok).toBe(true);
    if (!downgraded.ok) return;
    expect(downgraded.execution.policy).toBe("draft_then_approve");
    expect(downgraded.policy.downgraded).toEqual({ from: "auto", to: "draft_then_approve" });
  });

  it("fails the row and releases the hold when the runtime refuses to start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    client.start.mockRejectedValueOnce(new Error("queue down"));
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    expect(result).toMatchObject({ ok: false, reason: "not_started" });
    if (result.ok || result.reason !== "not_started") return;
    expect(result.execution).toMatchObject({ status: "failed", reservedCents: 0 });
    expect(result.execution.error).toMatch(/could not start/);
    const events = await getTestRepos().taskEvents.listForTask(session.user.id, task.id, 10);
    expect(events.map((e) => e.kind).sort()).toEqual(["execution.failed", "execution.queued"]);
  });

  it("an unavailable executor kind is reported, not failed", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    expect(await enqueue(session, task, { executor: "cursor_agent" })).toEqual({
      ok: false,
      reason: "executor_unavailable",
      executor: "cursor_agent",
    });
  });
});

describe("cancelExecution", () => {
  it("cancels a queued row at once", async () => {
    const session = await sessionFor("pro");
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    if (!result.ok) throw new Error("expected ok");
    const cancelled = await cancelExecution({
      userId: session.user.id,
      executionId: result.execution.id,
    });
    expect(cancelled).toMatchObject({ ok: true, immediate: true });
    if (!cancelled.ok) return;
    expect(cancelled.execution).toMatchObject({
      status: "cancelled",
      cancelReason: "user",
      cancelRequested: true,
      reservedCents: 0,
    });
    expect(cancelled.execution.finishedAt).not.toBeNull();
    const again = await cancelExecution({
      userId: session.user.id,
      executionId: result.execution.id,
    });
    expect(again).toMatchObject({ ok: false, reason: "already_finished" });
    expect(await cancelExecution({ userId: session.user.id, executionId: "exec_nope" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("only flags a running execution; the run stops at its next checkpoint", async () => {
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    if (!result.ok) throw new Error("expected ok");
    await repos.executions.transition(session.user.id, result.execution.id, {
      from: ["queued"],
      to: "running",
    });
    const cancelled = await cancelExecution({
      userId: session.user.id,
      executionId: result.execution.id,
    });
    expect(cancelled).toMatchObject({ ok: true, immediate: false });
    if (!cancelled.ok) return;
    expect(cancelled.execution).toMatchObject({ status: "running", cancelRequested: true });
  });

  it("cancelling a parked execution closes its decision and wakes the run", async () => {
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    if (!result.ok) throw new Error("expected ok");
    await repos.executions.transition(session.user.id, result.execution.id, {
      from: ["queued"],
      to: "running",
    });
    const decision = await openDraftReviewDecision(repos, session.user.id, {
      id: "dec_draft",
      execution: result.execution,
      executor: researchExecutor,
      summary: "Notes",
      draft: { title: "Notes", body: "body", format: "markdown" },
    });
    await repos.executions.transition(session.user.id, result.execution.id, {
      from: ["running"],
      to: "drafted",
      patch: { decisionId: decision.id },
    });
    const cancelled = await cancelExecution({
      userId: session.user.id,
      executionId: result.execution.id,
    });
    expect(cancelled).toMatchObject({ ok: true, immediate: true });
    expect((await repos.decisions.get(session.user.id, decision.id))?.status).toBe("expired");
    expect(await repos.decisions.countOpen(session.user.id)).toBe(0);
    expect(client.resume).toHaveBeenCalledWith("decision:dec_draft", { status: "expired" });
  });

  it("cancelExecutionsForTask stops every live execution of the task", async () => {
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    const task = await taskFor(session);
    const result = await enqueue(session, task);
    if (!result.ok) throw new Error("expected ok");
    expect(await cancelExecutionsForTask(repos, session.user.id, task.id)).toBe(1);
    expect((await repos.executions.get(session.user.id, result.execution.id))?.status).toBe(
      "cancelled",
    );
    expect(await cancelExecutionsForTask(repos, session.user.id, task.id)).toBe(0);
  });
});

describe("applyExecutionDecision / resolveExecutionDecision", () => {
  let seq = 0;
  async function parked(kind: "approval" | "draft_review" | "question") {
    seq += 1;
    const session = await sessionFor("pro");
    const repos = getTestRepos();
    const task = await taskFor(session);
    const result = await enqueue(session, task, {
      policy: kind === "approval" ? "ask_first" : "draft_then_approve",
    });
    if (!result.ok) throw new Error("expected ok");
    let execution = result.execution;
    let decision: Decision;
    if (kind === "approval") {
      decision = await openApprovalDecision(repos, session.user.id, {
        id: `dec_a_${seq}`,
        execution,
        executor: researchExecutor,
        action: "Research it",
        question: "Research it?",
        options: [APPROVE_OPTION, REJECT_OPTION],
        reason: "ask_first",
        estimateCents: 5,
      });
      execution = (await repos.executions.transition(session.user.id, execution.id, {
        from: ["queued"],
        to: "needs_approval",
        patch: { decisionId: decision.id },
      }))!;
    } else {
      await repos.executions.transition(session.user.id, execution.id, {
        from: ["queued"],
        to: "running",
      });
      if (kind === "draft_review") {
        decision = await openDraftReviewDecision(repos, session.user.id, {
          id: `dec_d_${seq}`,
          execution,
          executor: researchExecutor,
          summary: "Research notes",
          draft: { title: "Notes", body: "original body", format: "markdown" },
        });
        execution = (await repos.executions.transition(session.user.id, execution.id, {
          from: ["running"],
          to: "drafted",
          patch: { decisionId: decision.id },
        }))!;
      } else {
        decision = await openApprovalDecision(repos, session.user.id, {
          id: `dec_q_${seq}`,
          execution,
          executor: researchExecutor,
          action: "Research it",
          question: "Which lease?",
          options: ["Office", "Warehouse"],
          reason: "question",
          estimateCents: 0,
        });
        execution = (await repos.executions.transition(session.user.id, execution.id, {
          from: ["running"],
          to: "needs_decision",
          patch: { decisionId: decision.id },
        }))!;
      }
    }
    await repos.executions.appendStep(session.user.id, {
      executionId: execution.id,
      seq: 0,
      kind: "model_call",
      name: "research",
      status: "ok",
      input: null,
      output: null,
      durationMs: 10,
      costCents: 1.5,
    });
    const resolve = (status: DecisionResolution, option: string | null, draft?: ExecutionDraft) =>
      repos.decisions.resolve(session.user.id, decision.id, {
        status,
        answer:
          status === "answered" ? { text: null, option, via: "app", draft: draft ?? null } : null,
      });
    return { session, repos, task, execution, decision, resolve, userId: session.user.id };
  }

  it("approving an ask_first gate moves the row to running and the run must continue", async () => {
    const { repos, userId, execution, resolve, task } = await parked("approval");
    const resolved = (await resolve("answered", APPROVE_OPTION))!;
    const applied = await applyExecutionDecision(repos, userId, resolved);
    expect(applied.mode).toBe("approved");
    expect(applied.needsRun).toBe(true);
    expect(applied.execution).toMatchObject({ status: "running", decisionId: null });
    expect(applied.execution?.startedAt).not.toBeNull();
    const events = await repos.taskEvents.listForTask(userId, task.id, 10);
    expect(events.map((e) => e.kind)).toContain("execution.approved");
    // Applying again finds nothing to do.
    expect((await applyExecutionDecision(repos, userId, resolved)).mode).toBe("stale");
    expect((await repos.executions.get(userId, execution.id))?.status).toBe("running");
  });

  it("rejecting (or dismissing) cancels the execution and settles its cost", async () => {
    const a = await parked("approval");
    const rejected = (await a.resolve("answered", REJECT_OPTION))!;
    const applied = await applyExecutionDecision(a.repos, a.userId, rejected);
    expect(applied.mode).toBe("rejected");
    expect(applied.execution).toMatchObject({
      status: "cancelled",
      cancelReason: "rejected",
      reservedCents: 0,
      costCents: 1.5,
    });
    const kinds = (await a.repos.taskEvents.listForTask(a.userId, a.task.id, 10)).map(
      (e) => e.kind,
    );
    expect(kinds).toContain("execution.rejected");
    expect(kinds).toContain("execution.cancelled");

    const d = await parked("draft_review");
    const dismissed = (await d.resolve("dismissed", null))!;
    expect((await applyExecutionDecision(d.repos, d.userId, dismissed)).execution?.status).toBe(
      "cancelled",
    );
  });

  it("accepting a draft finishes the execution with the draft as the result", async () => {
    const { repos, userId, resolve } = await parked("draft_review");
    const accepted = (await resolve("answered", APPROVE_OPTION))!;
    const applied = await applyExecutionDecision(repos, userId, accepted);
    expect(applied.mode).toBe("accepted");
    expect(applied.needsRun).toBe(false);
    expect(applied.execution).toMatchObject({
      status: "done",
      costCents: 1.5,
      reservedCents: 0,
      result: { summary: "Research notes", draft: { body: "original body" } },
    });
    expect(applied.execution?.finishedAt).not.toBeNull();
  });

  it("editing then approving stores the edited draft and records the edit", async () => {
    const { repos, userId, resolve, task } = await parked("draft_review");
    const edited = (await resolve("answered", APPROVE_OPTION, {
      title: "Better notes",
      body: "edited body",
      format: "markdown",
    }))!;
    const applied = await applyExecutionDecision(repos, userId, edited);
    expect(applied.mode).toBe("edited");
    expect(applied.execution?.result?.draft).toEqual({
      title: "Better notes",
      body: "edited body",
      format: "markdown",
    });
    const kinds = (await repos.taskEvents.listForTask(userId, task.id, 10)).map((e) => e.kind);
    expect(kinds).toContain("execution.edited");
    expect(kinds).toContain("execution.done");
    expect(kinds).not.toContain("execution.approved");
    // An "edit" identical to the draft is an acceptance.
    const again = await parked("draft_review");
    const same = (await again.resolve("answered", APPROVE_OPTION, {
      title: "Notes",
      body: "original body ",
      format: "markdown",
    }))!;
    expect((await applyExecutionDecision(again.repos, again.userId, same)).mode).toBe("accepted");
  });

  it("answering an executor question stores the answer and resumes the run", async () => {
    const { repos, userId, resolve } = await parked("question");
    const answered = (await resolve("answered", "Warehouse"))!;
    const applied = await applyExecutionDecision(repos, userId, answered);
    expect(applied.mode).toBe("answered");
    expect(applied.needsRun).toBe(true);
    expect(applied.execution).toMatchObject({ status: "running", answers: ["Warehouse"] });
  });

  it("an expired decision cancels with reason expired", async () => {
    const { repos, userId, resolve } = await parked("approval");
    const expired = (await resolve("expired", null))!;
    const applied = await applyExecutionDecision(repos, userId, expired);
    expect(applied.mode).toBe("expired");
    expect(applied.execution).toMatchObject({ status: "cancelled", cancelReason: "expired" });
  });

  it("a decision that is not the execution's current wait is stale", async () => {
    const { repos, userId, execution, resolve } = await parked("approval");
    await repos.executions.update(userId, execution.id, { decisionId: "dec_other" });
    const resolved = (await resolve("answered", APPROVE_OPTION))!;
    expect((await applyExecutionDecision(repos, userId, resolved)).mode).toBe("stale");
    expect((await repos.executions.get(userId, execution.id))?.status).toBe("needs_approval");
  });

  it("resolveExecutionDecision wakes the run, and restarts one when nothing was waiting", async () => {
    const { repos, userId, resolve, execution } = await parked("approval");
    const resolved = (await resolve("answered", APPROVE_OPTION))!;
    client.resume.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    client.start.mockClear();
    const outcome = await resolveExecutionDecision(repos, userId, resolved, {
      offline: true,
      modelPreference: null,
    });
    expect(outcome).toMatchObject({ mode: "approved", resumed: false, restarted: true });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start.mock.calls[0]![1]).toEqual([
      {
        userId,
        executionId: execution.id,
        taskId: execution.taskId,
        offline: true,
        modelPreference: null,
      },
    ]);

    // A draft acceptance needs no run: not_found is fine and nothing restarts.
    const d = await parked("draft_review");
    client.resume.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    client.start.mockClear();
    const accepted = (await d.resolve("answered", APPROVE_OPTION))!;
    const done = await resolveExecutionDecision(d.repos, d.userId, accepted, {
      offline: true,
      modelPreference: null,
    });
    expect(done).toMatchObject({ mode: "accepted", resumed: false, restarted: false });
    expect(client.start).not.toHaveBeenCalled();
  });
});
