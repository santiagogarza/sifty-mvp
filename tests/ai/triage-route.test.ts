import { listAiRuns } from "@/lib/ai/ai-runs";
import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { siftTask } from "@/lib/workflows/sift-task";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * `POST /api/triage` is "re-sift now": it validates, gates, writes the
 * accounting row, hands the task to the workflow, and answers 202. The
 * workflow itself is stubbed through the dispatch seam; its steps are
 * covered in sift-execute.test.ts.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
};

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("CREATOR_EMAIL", "creator@example.com");
  client.start.mockReset();
  client.start.mockResolvedValue({ runId: "wrun_resift" });
  setWorkflowClientForTesting(client);

  const created = await createUserWithCookie(getTestRepos(), {
    email: "regular@example.com",
    isCreator: false,
  });
  cookie = created.cookie;
  userId = created.user.id;
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

function buildReq(body: unknown, opts?: { offline?: boolean; cookie?: string | null }) {
  const url = `http://localhost/api/triage${opts?.offline ? "?offline=1" : ""}`;
  const headers: HeadersInit = { "content-type": "application/json" };
  if (opts?.cookie !== null) headers.cookie = opts?.cookie ?? cookie;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function post(body: unknown, opts?: { offline?: boolean; cookie?: string | null }) {
  const { POST } = await import("@/app/api/triage/route");
  return POST(buildReq(body, opts));
}

describe("POST /api/triage (re-sift)", () => {
  it("rejects bodies without a taskId", async () => {
    const res = await post({ sourceText: "legacy clients sent text" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid body");
  });

  it("returns 401 when not signed in and 404 for someone else's task", async () => {
    expect((await post({ taskId: "task_x" }, { cookie: null })).status).toBe(401);
    const other = await createUserWithCookie(getTestRepos(), { email: "other@example.com" });
    const theirs = await getTestRepos().tasks.create(other.user.id, {
      sourceText: "Not yours",
      sourceContext: null,
    });
    expect((await post({ taskId: theirs.id })).status).toBe(404);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("enqueues siftTask, writes the accounting row, and answers 202 with the pending task", async () => {
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Call the bank",
      sourceContext: null,
    });
    await repos.tasks.update(userId, task.id, { aiStatus: "ready", aiAttempts: 1 });

    const res = await post({ taskId: task.id, modelPreference: "quality" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.runId).toBe("wrun_resift");
    expect(body.siftId).toMatch(/^sift_/);
    expect(body.task.aiStatus).toBe("pending");
    expect(body.task.siftId).toBe(body.siftId);

    expect(client.start).toHaveBeenCalledTimes(1);
    const [fn, args] = client.start.mock.calls[0]!;
    expect(fn).toBe(siftTask);
    expect(args[0]).toMatchObject({
      userId,
      taskId: task.id,
      siftId: body.siftId,
      modelPreference: "quality",
      offline: false,
    });

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      stage: SIFT_ACCOUNTING_STAGE,
      siftId: body.siftId,
      transport: "workflow",
      status: "succeeded",
      promptVersion: "sift.v1",
    });
    // The accounting row is the billing unit: it already counts.
    expect(await repos.aiRuns.countSucceededToday(userId)).toBe(1);
  });

  it("accepts the legacy modelId field as a preference", async () => {
    const task = await getTestRepos().tasks.create(userId, {
      sourceText: "Draft email",
      sourceContext: null,
    });
    const res = await post({ taskId: task.id, modelId: "claude-sonnet" });
    expect(res.status).toBe(202);
    expect(client.start.mock.calls[0]![1][0]).toMatchObject({ modelPreference: "claude-sonnet" });
  });

  it("offline=1 is carried into the workflow input and does not count against the cap", async () => {
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Draft email",
      sourceContext: null,
    });
    const res = await post({ taskId: task.id }, { offline: true });
    expect(res.status).toBe(202);
    expect(client.start.mock.calls[0]![1][0]).toMatchObject({ offline: true });
    expect(await repos.aiRuns.countSucceededToday(userId)).toBe(0);
  });

  it("offline switches are ignored on Vercel production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SIFTY_AI_OFFLINE", "1");
    const task = await getTestRepos().tasks.create(userId, {
      sourceText: "Draft email",
      sourceContext: null,
    });
    const res = await post({ taskId: task.id }, { offline: true });
    expect(res.status).toBe(202);
    expect(client.start.mock.calls[0]![1][0]).toMatchObject({ offline: false });
  });

  it("a re-sift supersedes the running one: the task takes the new siftId", async () => {
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Draft email",
      sourceContext: null,
    });
    const first = await (await post({ taskId: task.id })).json();
    const second = await (await post({ taskId: task.id })).json();
    expect(second.siftId).not.toBe(first.siftId);
    expect((await repos.tasks.get(userId, task.id))?.siftId).toBe(second.siftId);
  });

  it("answers 503 and marks the task failed when the workflow cannot start", async () => {
    const repos = getTestRepos();
    client.start.mockRejectedValue(new Error("no world"));
    const task = await repos.tasks.create(userId, {
      sourceText: "Draft email",
      sourceContext: null,
    });
    const res = await post({ taskId: task.id });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.task.aiStatus).toBe("failed");
    expect(body.task.aiError).toMatch(/could not start/);
    // The accounting row flipped, so the failed attempt is not billed.
    expect(await repos.aiRuns.countSucceededToday(userId)).toBe(0);
    const runs = await listAiRuns(userId);
    expect(runs[0]?.status).toBe("failed");
  });
});
