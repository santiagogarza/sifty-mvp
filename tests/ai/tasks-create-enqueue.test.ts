import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { FREE_SIFTS_PER_DAY, TRIAL_DAYS, trialSnapshot } from "@/lib/entitlements/entitlements";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { siftTask } from "@/lib/workflows/sift-task";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * `POST /api/tasks` is where sifting starts: a new capture is handed to the
 * workflow in the same request, the tier's daily cap is enforced before
 * anything is enqueued, and replays never double-enqueue.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
};

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  __resetRateLimits();
  client.start.mockReset();
  client.start.mockResolvedValue({ runId: "wrun_create" });
  setWorkflowClientForTesting(client);
  const created = await createUserWithCookie(getTestRepos(), { email: "capture@example.com" });
  cookie = created.cookie;
  userId = created.user.id;
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function create(body: Record<string, unknown>, query = "") {
  const { POST } = await import("@/app/api/tasks/route");
  return POST(
    new Request(`http://localhost/api/tasks${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/tasks enqueues siftTask", () => {
  it("a fresh capture is enqueued with the model preference and comes back pending", async () => {
    const res = await create({
      id: "task_new1",
      sourceText: "Call the bank tomorrow",
      aiStatus: "pending",
      modelPreference: "fast",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sift).toMatchObject({ enqueued: true, runId: "wrun_create" });
    expect(body.task.aiStatus).toBe("pending");
    expect(body.task.siftId).toBe(body.sift.siftId);

    expect(client.start).toHaveBeenCalledTimes(1);
    const [fn, args] = client.start.mock.calls[0]!;
    expect(fn).toBe(siftTask);
    expect(args[0]).toMatchObject({
      userId,
      taskId: "task_new1",
      siftId: body.sift.siftId,
      modelPreference: "fast",
      offline: false,
    });

    const runs = await getTestRepos().aiRuns.list(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ stage: SIFT_ACCOUNTING_STAGE, taskId: "task_new1" });
  });

  it("does not sift replays of already-organized tasks or idle duplicates", async () => {
    for (const aiStatus of ["ready", "idle"]) {
      const res = await create({ sourceText: `Replay ${aiStatus}`, aiStatus, title: "Kept" });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sift).toEqual({ enqueued: false, reason: "not_wanted" });
      expect(body.task.aiStatus).toBe(aiStatus);
      expect(body.task.title).toBe("Kept");
    }
    expect(client.start).not.toHaveBeenCalled();
  });

  it("a replayed create of a task the server is already sifting is idempotent", async () => {
    const first = await (
      await create({ id: "task_replay", sourceText: "Replay me", aiStatus: "pending" })
    ).json();
    expect(first.sift.enqueued).toBe(true);
    // Simulate the workflow having progressed before the client retries.
    await getTestRepos().tasks.update(userId, "task_replay", {
      aiStatus: "running",
      siftStage: "triage",
      title: "Enriched title",
    });

    const again = await (
      await create({ id: "task_replay", sourceText: "Replay me", aiStatus: "pending" })
    ).json();
    expect(again.sift).toEqual({ enqueued: false, reason: "already_sifting" });
    expect(again.task.aiStatus).toBe("running");
    expect(again.task.siftStage).toBe("triage");
    expect(again.task.title).toBe("Enriched title");
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("a replayed create never writes the stale capture over sift-written fields", async () => {
    await create({ id: "task_stale", sourceText: "Draft the update", aiStatus: "pending" });
    const repos = getTestRepos();
    // The workflow enriched and routed the task meanwhile.
    await repos.tasks.update(userId, "task_stale", {
      aiStatus: "ready",
      title: "Investor update",
      due: "2026-10-16",
      lifecycle: "waiting",
      confidence: 0.8,
      rationale: "why",
    });

    // The client retries the create with its full un-sifted snapshot, plus
    // one field the user did edit in the meantime.
    const res = await create({
      id: "task_stale",
      sourceText: "Draft the update",
      aiStatus: "pending",
      title: "Draft the update",
      due: null,
      confidence: 0,
      rationale: null,
      nextAction: "Open last quarter's doc",
      editedFields: ["nextAction"],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sift).toEqual({ enqueued: false, reason: "already_sifting" });
    expect(body.task.title).toBe("Investor update");
    expect(body.task.due).toBe("2026-10-16");
    expect(body.task.lifecycle).toBe("waiting");
    expect(body.task.confidence).toBe(0.8);
    expect(body.task.rationale).toBe("why");
    expect(body.task.aiStatus).toBe("ready");
    expect(body.task.nextAction).toBe("Open last quarter's doc");
    expect(body.task.editedFields).toEqual(["nextAction"]);

    // The capture-default lifecycle never undoes routing; a user move does land.
    const kept = await (
      await create({ id: "task_stale", sourceText: "Draft the update", lifecycle: "inbox" })
    ).json();
    expect(kept.task.lifecycle).toBe("waiting");
    const moved = await (
      await create({ id: "task_stale", sourceText: "Draft the update", lifecycle: "active" })
    ).json();
    expect(moved.task.lifecycle).toBe("active");
  });

  it("the per-IP AI limit covers capture: the task is created, the sift is refused", async () => {
    vi.stubEnv("RATELIMIT_TRIAGE_IP_PER_MIN", "1");
    const headers = { "x-forwarded-for": "9.9.9.9" };
    const { POST } = await import("@/app/api/tasks/route");
    const fire = (id: string) =>
      POST(
        new Request("http://localhost/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json", cookie, ...headers },
          body: JSON.stringify({ id, sourceText: "Burst", aiStatus: "pending" }),
        }),
      );
    const first = await (await fire("task_ip1")).json();
    expect(first.sift.enqueued).toBe(true);
    const second = await (await fire("task_ip2")).json();
    expect(second.sift).toEqual({ enqueued: false, reason: "denied", code: "rate_limited" });
    expect(second.task.aiStatus).toBe("failed");
    expect(second.task.aiError).toMatch(/Too many AI requests/);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect((await getTestRepos().tasks.get(userId, "task_ip2"))?.sourceText).toBe("Burst");
  });

  it("two overlapping creates of the same capture enqueue exactly one sift", async () => {
    const body = { id: "task_race", sourceText: "Race me", aiStatus: "pending" };
    const [a, b] = await Promise.all([create(body), create(body)]);
    const results = [await a.json(), await b.json()];
    expect(results.filter((r) => r.sift.enqueued)).toHaveLength(1);
    expect(results.filter((r) => r.sift.reason === "already_sifting")).toHaveLength(1);
    expect(client.start).toHaveBeenCalledTimes(1);
    const repos = getTestRepos();
    expect(await repos.aiRuns.countSucceededToday(userId)).toBe(1);
    const task = await repos.tasks.get(userId, "task_race");
    expect(task?.siftId).toBe(results.find((r) => r.sift.enqueued)!.sift.siftId);
  });

  it("a start failure never overwrites a newer sift that already claimed the task", async () => {
    const repos = getTestRepos();
    // The runtime refuses, but only after a re-sift has taken the task over.
    client.start.mockImplementationOnce(async () => {
      await repos.tasks.update(userId, "task_late", { siftId: "sift_newer", aiStatus: "running" });
      throw new Error("queue down");
    });
    const body = await (
      await create({ id: "task_late", sourceText: "Late failure", aiStatus: "pending" })
    ).json();
    expect(body.sift).toEqual({ enqueued: false, reason: "not_started" });
    const task = await repos.tasks.get(userId, "task_late");
    expect(task?.siftId).toBe("sift_newer");
    expect(task?.aiStatus).toBe("running");
  });

  it("offline=1 is passed through to the workflow", async () => {
    const res = await create({ sourceText: "Offline capture", aiStatus: "pending" }, "?offline=1");
    expect(res.status).toBe(201);
    expect(client.start.mock.calls[0]![1][0]).toMatchObject({ offline: true });
  });

  it("at the free cap the task is created but not enqueued, and carries the cap message", async () => {
    const repos = getTestRepos();
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(userId, trialSnapshot(TRIAL_DAYS, started)); // trial lapsed → free
    for (let i = 0; i < FREE_SIFTS_PER_DAY; i += 1) {
      await repos.aiRuns.insert({
        userId,
        taskId: null,
        promptVersion: "sift.v1",
        stage: SIFT_ACCOUNTING_STAGE,
        siftId: `sift_${i}`,
        model: "sifty.workflow",
        transport: "workflow",
        status: "succeeded",
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        costCents: 0,
        offline: false,
        error: null,
      });
    }

    const res = await create({
      id: "task_capped",
      sourceText: "One too many",
      aiStatus: "pending",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sift).toEqual({ enqueued: false, reason: "denied", code: "free_cap" });
    expect(body.task.aiStatus).toBe("failed");
    expect(body.task.aiError).toMatch(/upgrade to pro/i);
    expect(body.task.siftId).toBeNull();
    expect(client.start).not.toHaveBeenCalled();
    // No accounting row for a denied sift.
    expect(await repos.aiRuns.countSucceededToday(userId)).toBe(FREE_SIFTS_PER_DAY);
    // The task itself is durable regardless.
    expect((await repos.tasks.get(userId, "task_capped"))?.sourceText).toBe("One too many");
  });

  it("when the runtime refuses to start, the task is failed and the sift is not billed", async () => {
    client.start.mockRejectedValue(new Error("queue down"));
    const res = await create({ id: "task_nostart", sourceText: "Try me", aiStatus: "pending" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sift).toEqual({ enqueued: false, reason: "not_started" });
    expect(body.task.aiStatus).toBe("failed");
    expect(body.task.aiError).toMatch(/could not start/);
    expect(await getTestRepos().aiRuns.countSucceededToday(userId)).toBe(0);
  });
});
