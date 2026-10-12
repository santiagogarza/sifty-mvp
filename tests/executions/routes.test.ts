import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * The execution API against the in-memory repos with the workflow client
 * stubbed: run, read, cancel, and the saved policies, with tenancy.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

let cookie: string;
let userId: string;
let otherCookie: string;
let taskId: string;

beforeEach(async () => {
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  __resetRateLimits();
  client.start.mockReset().mockResolvedValue({ runId: "wrun_route" });
  client.resume.mockReset().mockResolvedValue({ ok: true, runId: "wrun_route" });
  setWorkflowClientForTesting(client);
  const repos = getTestRepos();
  const me = await createUserWithCookie(repos, { email: "runner@example.com" });
  cookie = me.cookie;
  userId = me.user.id;
  // Pro, so execution is allowed.
  await repos.entitlements.upsert(userId, {
    ...emptySnapshot(),
    tier: "pro",
    subscriptionActive: true,
  });
  const other = await createUserWithCookie(repos, { email: "other-runner@example.com" });
  otherCookie = other.cookie;
  const task = await repos.tasks.create(userId, {
    sourceText: "Research the lease",
    sourceContext: null,
  });
  taskId = task.id;
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function execute(
  id: string,
  body: Record<string, unknown> | null,
  headers: Record<string, string> = { cookie },
) {
  const { POST } = await import("@/app/api/tasks/[id]/execute/route");
  return POST(
    new Request(`http://localhost/api/tasks/${id}/execute?offline=1`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === null ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function getExecution(id: string, headers: Record<string, string> = { cookie }) {
  const { GET } = await import("@/app/api/executions/[id]/route");
  return GET(new Request(`http://localhost/api/executions/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

async function cancel(id: string, headers: Record<string, string> = { cookie }) {
  const { POST } = await import("@/app/api/executions/[id]/cancel/route");
  return POST(
    new Request(`http://localhost/api/executions/${id}/cancel`, { method: "POST", headers }),
    {
      params: Promise.resolve({ id }),
    },
  );
}

async function listForTask(id: string, headers: Record<string, string> = { cookie }) {
  const { GET } = await import("@/app/api/tasks/[id]/executions/route");
  return GET(new Request(`http://localhost/api/tasks/${id}/executions`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/tasks/:id/execute", () => {
  it("requires a session and an owned task", async () => {
    expect((await execute(taskId, {}, {})).status).toBe(401);
    expect((await execute("task_nope", {})).status).toBe(404);
    expect((await execute(taskId, {}, { cookie: otherCookie })).status).toBe(404);
    expect((await execute(taskId, { policy: "yolo" })).status).toBe(400);
  });

  it("enqueues with 202, replays with 200, refuses a second live run with 409, cancels", async () => {
    const first = await execute(taskId, { idempotencyKey: "k1", policy: "ask_first" });
    expect(first.status).toBe(202);
    const body = await first.json();
    expect(body.created).toBe(true);
    expect(body.runId).toBe("wrun_route");
    expect(body.execution).toMatchObject({ status: "queued", policy: "ask_first", taskId });
    expect(body.policy).toMatchObject({ policy: "ask_first", source: "request" });
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start.mock.calls[0]![1]).toEqual([
      expect.objectContaining({ userId, taskId, offline: true }),
    ]);

    const replay = await execute(taskId, { idempotencyKey: "k1" });
    expect(replay.status).toBe(200);
    expect((await replay.json()).created).toBe(false);

    const second = await execute(taskId, { idempotencyKey: "k2" });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("already_running");

    const read = await getExecution(body.execution.id);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ execution: { id: body.execution.id }, steps: [] });
    expect((await getExecution(body.execution.id, { cookie: otherCookie })).status).toBe(404);

    const listed = await listForTask(taskId);
    expect((await listed.json()).executions).toHaveLength(1);
    expect((await listForTask(taskId, { cookie: otherCookie })).status).toBe(404);

    expect((await cancel(body.execution.id, { cookie: otherCookie })).status).toBe(404);
    const stopped = await cancel(body.execution.id);
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({
      immediate: true,
      execution: { status: "cancelled", cancelReason: "user" },
    });
    expect((await cancel(body.execution.id)).status).toBe(409);

    // After the cancel the task may run again.
    expect((await execute(taskId, { idempotencyKey: "k3" })).status).toBe(202);
  });

  it("answers 402 with a code for the free tier and for a used-up budget", async () => {
    const repos = getTestRepos();
    await repos.entitlements.upsert(userId, emptySnapshot());
    const free = await execute(taskId, {});
    expect(free.status).toBe(402);
    expect(await free.json()).toMatchObject({ code: "execution_pro", execution: null });

    await repos.entitlements.upsert(userId, {
      ...emptySnapshot(),
      tier: "pro",
      subscriptionActive: true,
    });
    const spent = await repos.tasks.create(userId, { sourceText: "spent", sourceContext: null });
    const earlier = await repos.executions.create(userId, {
      taskId: spent.id,
      executor: "research",
      policy: "auto",
      connector: null,
      idempotencyKey: "earlier",
    });
    await repos.executions.transition(userId, earlier.execution.id, {
      from: ["queued"],
      to: "done",
    });
    await repos.executions.settle(userId, earlier.execution.id, { costCents: 1000 });
    const over = await execute(taskId, {});
    expect(over.status).toBe(402);
    const body = await over.json();
    expect(body.code).toBe("execution_budget");
    expect(body.execution).toMatchObject({ status: "failed" });
    expect(client.start).not.toHaveBeenCalled();
  });

  it("deleting the task cancels its live execution and closes its decision", async () => {
    const started = await execute(taskId, { idempotencyKey: "del", policy: "ask_first" });
    expect(started.status).toBe(202);
    const { execution } = await started.json();
    const repos = getTestRepos();
    // Park it the way the run would.
    const { openApprovalDecision } = await import("@/lib/executions/service");
    const { researchExecutor } = await import("@/lib/executions/executors");
    const decision = await openApprovalDecision(repos, userId, {
      id: "dec_del",
      execution,
      executor: researchExecutor,
      action: "Research it",
      question: "Research it?",
      options: ["Approve", "Reject"],
      reason: "ask_first",
      estimateCents: 5,
    });
    await repos.executions.transition(userId, execution.id, {
      from: ["queued"],
      to: "needs_approval",
      patch: { decisionId: decision.id },
    });
    const { DELETE } = await import("@/app/api/tasks/[id]/route");
    const res = await DELETE(
      new Request(`http://localhost/api/tasks/${taskId}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(res.status).toBe(200);
    // The run was released before the cascade removed its rows.
    expect(client.resume).toHaveBeenCalledWith("decision:dec_del", { status: "expired" });
    expect(await repos.executions.get(userId, execution.id)).toBeNull();
    expect(await repos.decisions.countOpen(userId)).toBe(0);
    expect(await repos.executions.monthlyUsage(userId)).toEqual({
      committedCents: 0,
      reservedCents: 0,
    });
  });

  it("an executor that is not available yet is a 400", async () => {
    const res = await execute(taskId, { executor: "cursor_agent" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("executor_unavailable");
  });
});

describe("/api/execution-policies", () => {
  async function call(
    method: "GET" | "PUT" | "DELETE",
    query: string,
    body?: unknown,
    headers = { cookie },
  ) {
    const route = await import("@/app/api/execution-policies/route");
    const req = new Request(`http://localhost/api/execution-policies${query}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return route[method](req);
  }

  it("reads the default, saves, lists, and clears per tenant", async () => {
    expect((await call("GET", `?scope=task&key=${taskId}`, undefined, {} as never)).status).toBe(
      401,
    );
    expect((await call("GET", "?scope=nope")).status).toBe(400);

    const before = await call("GET", `?scope=task&key=${taskId}`);
    expect(await before.json()).toEqual({
      scope: "task",
      key: taskId,
      policy: "draft_then_approve",
      saved: false,
      default: "draft_then_approve",
    });

    expect(
      (await call("PUT", "", { scope: "task", key: "task_nope", policy: "auto" })).status,
    ).toBe(404);
    expect((await call("PUT", "", { scope: "task", key: taskId, policy: "yolo" })).status).toBe(
      400,
    );
    const saved = await call("PUT", "", { scope: "task", key: taskId, policy: "ask_first" });
    expect(saved.status).toBe(200);
    expect((await saved.json()).policy).toMatchObject({
      scope: "task",
      key: taskId,
      policy: "ask_first",
    });

    const connector = await call("PUT", "", {
      scope: "connector",
      key: "gmail",
      policy: "ask_first",
    });
    expect(connector.status).toBe(200);
    const listed = await call("GET", "?scope=connector");
    expect((await listed.json()).policies).toEqual([
      expect.objectContaining({ key: "gmail", policy: "ask_first" }),
    ]);

    // Another tenant neither sees nor clears it.
    expect(
      (
        await (
          await call("GET", `?scope=task&key=${taskId}`, undefined, { cookie: otherCookie })
        ).json()
      ).saved,
    ).toBe(false);
    expect(
      (
        await (
          await call("DELETE", "", { scope: "task", key: taskId }, { cookie: otherCookie })
        ).json()
      ).cleared,
    ).toBe(false);

    // The saved task policy drives the next run.
    const run = await execute(taskId, {});
    expect(run.status).toBe(202);
    expect((await run.json()).policy).toMatchObject({ policy: "ask_first", source: "task" });

    const cleared = await call("DELETE", "", { scope: "task", key: taskId });
    expect(await cleared.json()).toEqual({ cleared: true, default: "draft_then_approve" });
    expect((await (await call("GET", `?scope=task&key=${taskId}`)).json()).saved).toBe(false);
  });
});
