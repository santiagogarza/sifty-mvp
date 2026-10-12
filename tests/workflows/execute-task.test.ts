import type { Session } from "@/lib/auth/session";
import { answerDecision, dismissDecision } from "@/lib/decisions/actions";
import { decisionHookToken } from "@/lib/decisions/hook";
import type { Execution, ExecutionStatus } from "@/lib/domain/types";
import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { APPROVE_OPTION, REJECT_OPTION } from "@/lib/executions/copy";
import {
  ExecutionCancelledError,
  type ExecutorDefinition,
  researchExecutor,
  setExecutorForTesting,
} from "@/lib/executions/executors";
import { type ExecutionInput, cancelExecution, enqueueExecution } from "@/lib/executions/service";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

/**
 * The `executeTask` workflow body end to end against the in-memory repos.
 * Without the Workflow compiler the directives are no-ops, so this is the
 * orchestration the runtime replays; `createHook` / `sleep` are scripted
 * and the stubbed workflow client resolves the scripted hook, exactly as
 * `resumeHook` would, so the Decisions actions can play the human.
 */

interface ScriptedHook {
  token: string;
  resolve: (payload: unknown) => void;
  disposed: boolean;
}
const hooks: ScriptedHook[] = [];
let sleepResolve: (() => void) | null = null;

vi.mock("workflow", () => {
  class FatalError extends Error {}
  return {
    FatalError,
    getWorkflowMetadata: () => ({ workflowRunId: "wrun_exec_test" }),
    sleep: () =>
      new Promise<void>((resolve) => {
        sleepResolve = resolve;
      }),
    createHook: (opts: { token: string }) => {
      let resolve!: (payload: unknown) => void;
      const payload = new Promise<unknown>((r) => {
        resolve = r;
      });
      const scripted: ScriptedHook = { token: opts.token, resolve, disposed: false };
      hooks.push(scripted);
      return Object.assign(payload, {
        token: opts.token,
        getConflict: async () => null,
        dispose: () => {
          scripted.disposed = true;
        },
      });
    },
  };
});

/** Started inputs; `run: true` executes the workflow inline (the restart path). */
const started: ExecutionInput[] = [];
let runOnStart = false;
const client: WorkflowClient = {
  async start(_workflow, args) {
    const input = args[0] as ExecutionInput;
    started.push(input);
    if (runOnStart) {
      const { executeTask } = await import("@/lib/workflows/execute-task");
      void executeTask(input).catch(() => undefined);
    }
    return { runId: `wrun_${started.length}` };
  },
  async wait() {
    return { status: "pending" };
  },
  async resume(token, payload) {
    const hook = hooks.find((h) => h.token === token);
    if (!hook) return { ok: false, reason: "not_found" };
    hook.resolve(payload);
    return { ok: true, runId: "wrun_exec_test" };
  },
};

async function seed(opts: { policy?: Execution["policy"]; sourceText?: string } = {}) {
  const repos = getTestRepos();
  const user = await repos.users.create({
    email: `exec-${Math.random().toString(36).slice(2)}@example.com`,
    displayName: "E",
    isCreator: false,
  });
  const entitlement = { ...emptySnapshot(), tier: "pro" as const, subscriptionActive: true };
  await repos.entitlements.upsert(user.id, entitlement);
  const session: Session = { user, entitlement, sessionId: null };
  const created = await repos.tasks.create(user.id, {
    sourceText: opts.sourceText ?? "Research the lease renewal",
    sourceContext: null,
  });
  const task = (await repos.tasks.update(user.id, created.id, {
    title: opts.sourceText ?? "Research the lease renewal",
    nextAction: "Read the current lease",
    aiStatus: "ready",
  }))!;
  const result = await enqueueExecution({
    session,
    task,
    policy: opts.policy ?? null,
    offline: true,
    modelPreference: null,
  });
  if (!result.ok) throw new Error(`enqueue failed: ${result.reason}`);
  const input = started[started.length - 1]!;
  return { repos, user, session, task, execution: result.execution, input };
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, label: string): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const decisionHooks = () => hooks.filter((h) => h.token.startsWith("decision:"));
const slotHooks = () => hooks.filter((h) => h.token.startsWith("exec:"));
const req = () => new Request("http://localhost/api/decisions/x/answer", { method: "POST" });

async function statusOf(repos: ReturnType<typeof getTestRepos>, userId: string, id: string) {
  return (await repos.executions.get(userId, id))!.status;
}

async function waitForStatus(
  repos: ReturnType<typeof getTestRepos>,
  userId: string,
  id: string,
  status: ExecutionStatus,
) {
  return until(
    () => repos.executions.get(userId, id),
    (e) => e?.status === status,
    `status ${status}`,
  ).then((e) => e!);
}

beforeEach(() => {
  hooks.length = 0;
  started.length = 0;
  runOnStart = false;
  sleepResolve = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  setWorkflowClientForTesting(client);
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  setExecutorForTesting("research", null);
  vi.restoreAllMocks();
});

describe("executeTask with the default policy (draft_then_approve)", () => {
  it("runs the executor, parks on a draft_review, releases its slot, and finishes when the draft is accepted", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, session, task, execution, input } = await seed();

    const run = executeTask(input);
    const drafted = await waitForStatus(repos, user.id, execution.id, "drafted");
    expect(drafted.startedAt).not.toBeNull();
    expect(drafted.workflowRunId).toBe("wrun_exec_test");
    expect(drafted.result?.draft?.body).toContain("Read the current lease");

    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    expect(decision).toMatchObject({
      kind: "draft_review",
      status: "open",
      resumeToken: decisionHookToken(decision!.id),
      payload: { kind: "draft_review", executionId: execution.id, executor: "research" },
    });
    expect(drafted.decisionId).toBe(decision!.id);
    expect(decisionHooks()[0]?.token).toBe(decision!.resumeToken);
    expect(slotHooks()).toHaveLength(1);
    expect(slotHooks()[0]!.disposed).toBe(true);

    const steps = await repos.executions.listSteps(user.id, execution.id, { limit: 50 });
    expect(steps.map((s) => s.name)).toEqual(["research.gather"]);
    expect(steps[0]!.input).toMatchObject({ title: "Research the lease renewal" });

    // The human approves through the real action: the row moves first, then the run wakes.
    const answered = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: null, option: APPROVE_OPTION, via: "app" },
      modelPreference: null,
      offline: true,
    });
    expect(answered.ok && answered.mode === "execution").toBe(true);
    if (!answered.ok || !answered.execution) return;
    expect(answered.execution.mode).toBe("accepted");
    expect(answered.execution.execution?.status).toBe("done");

    await expect(run).resolves.toEqual({ outcome: "finished", status: "done" });
    const done = (await repos.executions.get(user.id, execution.id))!;
    expect(done).toMatchObject({
      status: "done",
      reservedCents: 0,
      costCents: 0,
      decisionId: null,
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    const kinds = (await repos.taskEvents.listForTask(user.id, task.id, 20)).map((e) => e.kind);
    expect(kinds.sort()).toEqual(
      [
        "execution.queued",
        "execution.started",
        "execution.drafted",
        "execution.approved",
        "execution.done",
      ].sort(),
    );
  });

  it("an edited draft becomes the result; a rejected draft cancels the run", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const a = await seed();
    const runA = executeTask(a.input);
    await waitForStatus(a.repos, a.user.id, a.execution.id, "drafted");
    const [decisionA] = await a.repos.decisions.listOpenForTask(a.user.id, a.task.id, { limit: 5 });
    const edited = await answerDecision({
      req: req(),
      session: a.session,
      decisionId: decisionA!.id,
      answer: {
        text: null,
        option: APPROVE_OPTION,
        via: "app",
        draft: { title: "Lease notes", body: "Call the landlord first.", format: "markdown" },
      },
      modelPreference: null,
      offline: true,
    });
    expect(edited.ok && edited.execution?.mode === "edited").toBe(true);
    await expect(runA).resolves.toEqual({ outcome: "finished", status: "done" });
    expect((await a.repos.executions.get(a.user.id, a.execution.id))!.result?.draft).toEqual({
      title: "Lease notes",
      body: "Call the landlord first.",
      format: "markdown",
    });

    const b = await seed({ sourceText: "Research the vendor contract" });
    const runB = executeTask(b.input);
    await waitForStatus(b.repos, b.user.id, b.execution.id, "drafted");
    const [decisionB] = await b.repos.decisions.listOpenForTask(b.user.id, b.task.id, { limit: 5 });
    const rejected = await answerDecision({
      req: req(),
      session: b.session,
      decisionId: decisionB!.id,
      answer: { text: null, option: REJECT_OPTION, via: "link" },
      modelPreference: null,
      offline: true,
    });
    expect(rejected.ok && rejected.execution?.mode === "rejected").toBe(true);
    await expect(runB).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await b.repos.executions.get(b.user.id, b.execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "rejected",
      reservedCents: 0,
    });
  });

  it("dismissing the review from the inbox is a rejection", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, task, execution, input } = await seed();
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "drafted");
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    const dismissed = await dismissDecision({ userId: user.id, decisionId: decision!.id });
    expect(dismissed.ok && dismissed.execution?.mode === "rejected").toBe(true);
    await expect(run).resolves.toEqual({ outcome: "finished", status: "cancelled" });
  });

  it("the 7-day deadline cancels an ignored review as expired", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, execution, input } = await seed();
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "drafted");
    await until(
      async () => sleepResolve !== null,
      (v) => v,
      "the deadline timer",
    );
    sleepResolve!();
    await expect(run).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "expired",
    });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
  });

  it("when the deadline and an approval race, the approval wins", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, task, execution, input } = await seed();
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "drafted");
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    // The user wins the CAS but the wake is lost; the deadline fires.
    await repos.decisions.resolve(user.id, decision!.id, {
      status: "answered",
      answer: { text: null, option: APPROVE_OPTION, via: "app" },
    });
    await until(
      async () => sleepResolve !== null,
      (v) => v,
      "the deadline timer",
    );
    sleepResolve!();
    await expect(run).resolves.toEqual({ outcome: "finished", status: "done" });
  });

  it("cancelling a parked execution closes the review and ends the run", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, execution, input } = await seed();
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "drafted");
    const cancelled = await cancelExecution({ userId: user.id, executionId: execution.id });
    expect(cancelled).toMatchObject({ ok: true, immediate: true });
    await expect(run).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "user",
    });
  });
});

describe("executeTask with ask_first", () => {
  it("parks on an approval before any work; approving runs the executor and applies the result directly", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, session, task, execution, input } = await seed({ policy: "ask_first" });
    const run = executeTask(input);
    const parked = await waitForStatus(repos, user.id, execution.id, "needs_approval");
    expect(parked.startedAt).toBeNull();
    expect(await repos.executions.listSteps(user.id, execution.id, { limit: 10 })).toEqual([]);
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    expect(decision!.payload).toMatchObject({
      kind: "approval",
      reason: "ask_first",
      action: "Look into “Research the lease renewal” and write up notes",
      question: "Look into “Research the lease renewal” and write up notes?",
      options: [APPROVE_OPTION, REJECT_OPTION],
      estimateCents: 5,
    });
    expect(slotHooks()[0]!.disposed).toBe(true);

    const approved = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: null, option: APPROVE_OPTION, via: "link" },
      modelPreference: null,
      offline: true,
    });
    expect(approved.ok && approved.execution?.mode === "approved").toBe(true);
    await expect(run).resolves.toEqual({ outcome: "finished", status: "done" });
    const done = (await repos.executions.get(user.id, execution.id))!;
    expect(done.status).toBe("done");
    expect(done.result?.draft?.title).toBe("Research notes: Research the lease renewal");
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    // The slot was taken twice: before parking and after the approval.
    expect(slotHooks()).toHaveLength(2);
    const kinds = (await repos.taskEvents.listForTask(user.id, task.id, 20)).map((e) => e.kind);
    expect(kinds).toContain("execution.needs_approval");
    expect(kinds).toContain("execution.approved");
    expect(kinds).toContain("execution.done");
    // A text answer is not an approval for an ask_first gate.
  });

  it("rejecting the gate cancels without running anything", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, session, task, execution, input } = await seed({ policy: "ask_first" });
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "needs_approval");
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    const invalid = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: "maybe later", option: null, via: "app" },
      modelPreference: null,
      offline: true,
    });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid_answer" });
    const rejected = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: null, option: REJECT_OPTION, via: "app" },
      modelPreference: null,
      offline: true,
    });
    expect(rejected.ok).toBe(true);
    await expect(run).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await repos.executions.listSteps(user.id, execution.id, { limit: 10 })).toEqual([]);
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "rejected",
      reservedCents: 0,
    });
  });

  it("if the run is gone when the user approves, the service starts a new one that finishes the work", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, session, task, execution, input } = await seed({ policy: "ask_first" });
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "needs_approval");
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    // Simulate the deployment that lost the run: drop its hook.
    hooks.splice(hooks.indexOf(decisionHooks()[0]!), 1);
    runOnStart = true;
    const approved = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: null, option: APPROVE_OPTION, via: "app" },
      modelPreference: null,
      offline: true,
    });
    expect(approved.ok).toBe(true);
    expect(started).toHaveLength(2);
    await waitForStatus(repos, user.id, execution.id, "done");
    expect((await repos.executions.get(user.id, execution.id))!.workflowRunId).toBe(
      "wrun_exec_test",
    );
    // The orphaned first run never completes in this test; nothing waits on it.
    void run;
  });
});

describe("executeTask with auto", () => {
  it("a read-only executor under auto finishes with no decision at all", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, execution, input } = await seed({ policy: "auto" });
    await expect(executeTask(input)).resolves.toEqual({ outcome: "finished", status: "done" });
    expect(await repos.decisions.countOpen(user.id)).toBe(0);
    expect(decisionHooks()).toEqual([]);
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "done",
      result: { summary: "Research notes for “Research the lease renewal”" },
    });
  });
});

describe("executeTask with an executor that asks, fails, or is stopped", () => {
  const asking: ExecutorDefinition = {
    ...researchExecutor,
    async run(ctx) {
      if (ctx.answers.length === 0) {
        await ctx.log({
          kind: "tool_call",
          name: "lease.lookup",
          input: { apiKey: "sk-live_abcdefghijklmnopqrstu" },
          output: { found: 2 },
        });
        return {
          kind: "needs_decision",
          question: "Which lease?",
          options: ["Office", "Warehouse"],
        };
      }
      return { kind: "done", summary: `Looked into the ${ctx.answers[0]} lease`, draft: null };
    },
  };

  it("needs_decision parks on an approval question; the answer reaches the executor on resume, and the log is redacted", async () => {
    setExecutorForTesting("research", asking);
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, session, task, execution, input } = await seed({ policy: "auto" });
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "needs_decision");
    const [decision] = await repos.decisions.listOpenForTask(user.id, task.id, { limit: 5 });
    expect(decision!.payload).toMatchObject({
      kind: "approval",
      reason: "question",
      question: "Which lease?",
      options: ["Office", "Warehouse"],
    });
    const steps = await repos.executions.listSteps(user.id, execution.id, { limit: 10 });
    expect(steps[0]!.input).toEqual({ apiKey: "[redacted]" });

    const answered = await answerDecision({
      req: req(),
      session,
      decisionId: decision!.id,
      answer: { text: null, option: "Warehouse", via: "app" },
      modelPreference: null,
      offline: true,
    });
    expect(answered.ok && answered.execution?.mode === "answered").toBe(true);
    await expect(run).resolves.toEqual({ outcome: "finished", status: "done" });
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "done",
      answers: ["Warehouse"],
      result: { summary: "Looked into the Warehouse lease", draft: null },
    });
  });

  it("a failed outcome fails the execution and releases the hold; an exception is rethrown for Workflow's retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setExecutorForTesting("research", {
      ...researchExecutor,
      async run() {
        return { kind: "failed", error: "No lease on file" };
      },
    });
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const a = await seed();
    await expect(executeTask(a.input)).resolves.toEqual({ outcome: "finished", status: "failed" });
    expect(await a.repos.executions.get(a.user.id, a.execution.id)).toMatchObject({
      status: "failed",
      error: "No lease on file",
      reservedCents: 0,
    });

    let calls = 0;
    setExecutorForTesting("research", {
      ...researchExecutor,
      async run(ctx) {
        calls += 1;
        if (calls === 1) throw new Error("provider 503");
        return researchExecutor.run(ctx);
      },
    });
    const b = await seed({ sourceText: "Research the audit" });
    // The step throws. Under the runtime it is retried first; here the
    // error reaches the workflow body at once, which fails the row and
    // rethrows so the run is marked failed in the dashboard too.
    await expect(executeTask(b.input)).rejects.toThrow("provider 503");
    expect(await statusOf(b.repos, b.user.id, b.execution.id)).toBe("failed");
    const steps = await b.repos.executions.listSteps(b.user.id, b.execution.id, { limit: 10 });
    expect(steps.map((s) => s.name)).toEqual(["executor.error"]);
    expect(steps[0]!.status).toBe("error");
  });

  it("a cancel while the executor works stops it at the next checkpoint", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    setExecutorForTesting("research", {
      ...researchExecutor,
      async run(ctx) {
        await gate;
        await ctx.checkCancelled();
        return { kind: "done", summary: "should not happen", draft: null };
      },
    });
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, execution, input } = await seed({ policy: "auto" });
    const run = executeTask(input);
    await waitForStatus(repos, user.id, execution.id, "running");
    const cancelled = await cancelExecution({ userId: user.id, executionId: execution.id });
    expect(cancelled).toMatchObject({ ok: true, immediate: false });
    release();
    await expect(run).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await repos.executions.get(user.id, execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "user",
      result: null,
    });
    expect(() => {
      throw new ExecutionCancelledError();
    }).toThrow(/cancelled by the user/);
  });

  it("a cancel that lands before the first step ends the run before any work", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { repos, user, execution, input } = await seed();
    await cancelExecution({ userId: user.id, executionId: execution.id });
    await expect(executeTask(input)).resolves.toEqual({ outcome: "finished", status: "cancelled" });
    expect(await repos.executions.listSteps(user.id, execution.id, { limit: 10 })).toEqual([]);
  });

  it("a run for an execution that no longer exists ends as missing", async () => {
    const { executeTask } = await import("@/lib/workflows/execute-task");
    const { input } = await seed();
    await expect(executeTask({ ...input, executionId: "exec_gone" })).resolves.toEqual({
      outcome: "missing",
    });
  });
});
