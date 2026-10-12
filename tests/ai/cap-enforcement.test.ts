import { SIFT_ACCOUNTING_STAGE } from "@/lib/db/repos/types";
import {
  FREE_SIFTS_PER_DAY,
  PRO_FAIR_USE_SIFTS_PER_DAY,
  TRIAL_DAYS,
  trialSnapshot,
} from "@/lib/entitlements/entitlements";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Tier caps are enforced before a sift is enqueued, and counted in sifts:
 * the `sift` accounting row of a workflow run is one unit however many
 * stage rows follow it.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  // These tests seed many runs "just now"; raise the per-minute burst cap so
  // only the daily entitlement cap is under test.
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  client.start.mockReset();
  client.start.mockResolvedValue({ runId: "wrun_cap" });
  setWorkflowClientForTesting(client);
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

/** `n` finished workflow sifts, each with its accounting row plus five stage rows. */
async function seedSifts(repos: ReturnType<typeof getTestRepos>, userId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    const siftId = `sift_${i}`;
    await repos.aiRuns.insert({
      userId,
      taskId: null,
      promptVersion: "sift.v1",
      stage: SIFT_ACCOUNTING_STAGE,
      siftId,
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
    for (const stage of ["enrich", "prioritize", "triage", "subtasks", "plan"]) {
      await repos.aiRuns.insert({
        userId,
        taskId: null,
        promptVersion: `${stage}.v1`,
        stage,
        siftId,
        workflowRunId: `wrun_${i}`,
        model: "anthropic/claude-haiku-4.5",
        transport: "gateway",
        status: "succeeded",
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 20,
        costCents: 0.01,
        offline: false,
        error: null,
      });
    }
  }
}

async function resift(cookie: string, userId: string) {
  const task = await getTestRepos().tasks.create(userId, {
    sourceText: "Test the cap",
    sourceContext: null,
  });
  const { POST } = await import("@/app/api/triage/route");
  return POST(
    new Request("http://localhost/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ taskId: task.id }),
    }),
  );
}

describe("AI cap enforcement", () => {
  it("free user at the free cap → 402 free_cap with an upgrade path; nothing enqueued", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "free@example.com",
      isCreator: false,
    });
    // Trial lapsed → free tier.
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(user.id, trialSnapshot(TRIAL_DAYS, started));
    await seedSifts(repos, user.id, FREE_SIFTS_PER_DAY);

    const res = await resift(cookie, user.id);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("free_cap");
    expect(body.error).toMatch(/upgrade to pro/i);
    expect(body.entitlement.tier).toBe("free");
    expect(body.task.aiStatus).toBe("failed");
    expect(body.task.aiError).toBe(body.error);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("free user under the cap is admitted: five stage rows per sift do not eat the cap", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "free2@example.com",
      isCreator: false,
    });
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(user.id, trialSnapshot(TRIAL_DAYS, started));
    await seedSifts(repos, user.id, FREE_SIFTS_PER_DAY - 1);
    // 4 sifts × 6 rows = 24 rows, still 4 sifts.
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(FREE_SIFTS_PER_DAY - 1);

    const res = await resift(cookie, user.id);
    expect(res.status).toBe(202);
    expect(client.start).toHaveBeenCalledTimes(1);
    // The accepted sift is counted immediately, before any stage runs.
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(FREE_SIFTS_PER_DAY);
  });

  it("the next request after the accepted sift is already denied (no burst bypass)", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "burst@example.com",
      isCreator: false,
    });
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(user.id, trialSnapshot(TRIAL_DAYS, started));
    await seedSifts(repos, user.id, FREE_SIFTS_PER_DAY - 1);
    expect((await resift(cookie, user.id)).status).toBe(202);
    expect((await resift(cookie, user.id)).status).toBe(402);
    expect(client.start).toHaveBeenCalledTimes(1);
  });

  it("trialing user at the Pro fair-use ceiling → 402 fair_use_cap", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "trialer@example.com",
      isCreator: false,
    });
    await seedSifts(repos, user.id, PRO_FAIR_USE_SIFTS_PER_DAY);

    const res = await resift(cookie, user.id);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("fair_use_cap");
    expect(body.error).toMatch(/fair-use/i);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("creator account is never capped", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    await seedSifts(repos, user.id, 300);
    const res = await resift(cookie, user.id);
    expect(res.status).toBe(202);
  });
});
