import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import { FREE_SIFTS_PER_DAY, TRIAL_DAYS, trialSnapshot } from "@/lib/entitlements/entitlements";
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
