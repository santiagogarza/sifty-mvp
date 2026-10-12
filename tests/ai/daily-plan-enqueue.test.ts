import {
  IDLE_AFTER_DAYS,
  enqueueDailyPlan,
  enqueueNightlyPlans,
  planDateFor,
} from "@/lib/ai/plan/enqueue";
import type { Repos } from "@/lib/db/repos";
import {
  FREE_SIFTS_PER_DAY,
  PRO_FAIR_USE_SIFTS_PER_DAY,
  emptySnapshot,
  trialSnapshot,
} from "@/lib/entitlements/entitlements";
import { DEFAULT_PREFERENCES } from "@/lib/notifications/preferences";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { dailyPlan } from "@/lib/workflows/daily-plan";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Admission for daily plans: the `dailyPlan` cap, the daily sift cap
 * (one plan = one sift), one run per user at a time, one cron plan per
 * local day — and the two entry points, the nightly cron walk and the
 * manual route.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
};

const FIXED = new Date("2026-10-13T04:00:00.000Z");
/** Real clock: claims and leases stamp rows with `new Date()`. */
const NOW = new Date();

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("CRON_SECRET", "cron-secret-test");
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  __resetRateLimits();
  client.start.mockReset();
  client.start.mockResolvedValue({ runId: "wrun_plan" });
  setWorkflowClientForTesting(client);
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function proUser(repos: Repos, email = "pro@example.com") {
  const user = await repos.users.create({ email, displayName: "Pro", isCreator: false });
  await repos.entitlements.upsert(user.id, trialSnapshot(30, NOW));
  await repos.tasks.create(user.id, { sourceText: "Something open", sourceContext: null });
  return user;
}

async function freeUser(repos: Repos, email = "free@example.com") {
  const user = await repos.users.create({ email, displayName: "Free", isCreator: false });
  await repos.entitlements.upsert(user.id, emptySnapshot());
  await repos.tasks.create(user.id, { sourceText: "Something open", sourceContext: null });
  return user;
}

async function seedPlanRuns(repos: Repos, userId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    await repos.aiRuns.insert({
      userId,
      taskId: null,
      promptVersion: "dailyplan.v1",
      stage: "prioritize",
      model: "anthropic/claude-haiku-4.5",
      transport: "gateway",
      status: "succeeded",
      durationMs: 10,
      inputTokens: 1,
      outputTokens: 1,
      costCents: 0.001,
      offline: false,
      error: null,
    });
  }
}

describe("planDateFor", () => {
  it("plans today before the evening cutover and tomorrow after it, in the user's zone", () => {
    // 04:00 UTC: 21:00 the previous evening in Los Angeles, 06:00 in Ljubljana.
    expect(planDateFor(FIXED, "America/Los_Angeles", "cron")).toBe("2026-10-13");
    expect(planDateFor(FIXED, "Europe/Ljubljana", "cron")).toBe("2026-10-13");
    expect(planDateFor(FIXED, "Asia/Tokyo", "cron")).toBe("2026-10-13");
    const evening = new Date("2026-10-13T19:30:00.000Z");
    expect(planDateFor(evening, "UTC", "cron")).toBe("2026-10-14");
    // A manual re-plan is always for the day it is on.
    expect(planDateFor(evening, "UTC", "manual")).toBe("2026-10-13");
    expect(planDateFor(evening, "Asia/Tokyo", "manual")).toBe("2026-10-14");
  });
});

describe("enqueueDailyPlan", () => {
  it("claims a plan and starts the workflow with the plan as input", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const result = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "manual",
      timeZone: "Europe/Ljubljana",
      modelPreference: "quality",
      offline: false,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.plan.status).toBe("running");
    const planDate = planDateFor(NOW, "Europe/Ljubljana", "manual");
    expect(result.plan.planDate).toBe(planDate);
    expect(result.plan.workflowRunId).toBe("wrun_plan");
    expect(result.plan.aiRunId).toBeTruthy();
    expect(client.start).toHaveBeenCalledWith(dailyPlan, [
      {
        userId: user.id,
        planId: result.plan.id,
        aiRunId: result.plan.aiRunId,
        planDate,
        timeZone: "Europe/Ljubljana",
        trigger: "manual",
        modelPreference: "quality",
        offline: false,
      },
    ]);
  });

  it("reserves the billing row before start() so the next request already counts it", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
    const result = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "manual",
      timeZone: "UTC",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(1);
    const [row] = await repos.aiRuns.list(user.id);
    expect(row).toMatchObject({ stage: "prioritize", siftId: null, model: "sifty.workflow" });

    // A refused claim (plan already running) releases its reservation.
    const refused = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "manual",
      timeZone: "UTC",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.reason).toBe("already_running");
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(1);
    expect((await repos.aiRuns.list(user.id)).filter((r) => r.status === "failed")).toHaveLength(1);
  });

  it("a claim that throws releases the reservation and rethrows", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const boom = vi.spyOn(repos.dailyPlans, "claim").mockRejectedValueOnce(new Error("deadlock"));
    await expect(
      enqueueDailyPlan({
        repos,
        user,
        snapshot: await repos.entitlements.get(user.id),
        trigger: "manual",
        timeZone: "UTC",
        modelPreference: null,
        offline: false,
        now: NOW,
      }),
    ).rejects.toThrow("deadlock");
    boom.mockRestore();
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
    expect((await repos.aiRuns.list(user.id))[0]).toMatchObject({
      status: "failed",
      error: "claim failed",
    });
    expect(client.start).not.toHaveBeenCalled();
  });

  it("free accounts are not entitled; nothing is claimed or started", async () => {
    const repos = getTestRepos();
    const user = await freeUser(repos);
    const result = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "cron",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_entitled" });
    expect(client.start).not.toHaveBeenCalled();
    expect(await repos.dailyPlans.latest(user.id)).toBeNull();
  });

  it("a plan counts as a sift: at the fair-use cap it is refused", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    await seedPlanRuns(repos, user.id, PRO_FAIR_USE_SIFTS_PER_DAY);
    const result = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "cron",
      modelPreference: null,
      offline: false,
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("cap");
    expect(client.start).not.toHaveBeenCalled();
    expect(FREE_SIFTS_PER_DAY).toBeLessThan(PRO_FAIR_USE_SIFTS_PER_DAY);
  });

  it("one run per user at a time; a second cron claim for the same day is a no-op", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const snapshot = await repos.entitlements.get(user.id);
    const first = await enqueueDailyPlan({
      repos,
      user,
      snapshot,
      trigger: "cron",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(first.ok).toBe(true);
    const second = await enqueueDailyPlan({
      repos,
      user,
      snapshot,
      trigger: "cron",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.reason).toBe("already_running");

    // The first run finished; the same local day still refuses a cron rerun.
    await repos.dailyPlans.update(user.id, (first as { plan: { id: string } }).plan.id, {
      status: "completed",
    });
    const rerun = await enqueueDailyPlan({
      repos,
      user,
      snapshot,
      trigger: "cron",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(rerun).toEqual({ ok: false, reason: "already_planned" });
    // A manual re-plan on the same day is fine.
    const manual = await enqueueDailyPlan({
      repos,
      user,
      snapshot,
      trigger: "manual",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(manual.ok).toBe(true);
    expect(client.start).toHaveBeenCalledTimes(2);
  });

  it("a run that cannot start flips its row to failed so nothing hangs", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    client.start.mockRejectedValueOnce(new Error("queue down"));
    const result = await enqueueDailyPlan({
      repos,
      user,
      snapshot: await repos.entitlements.get(user.id),
      trigger: "manual",
      modelPreference: null,
      offline: false,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "not_started") throw new Error("unreachable");
    expect(result.plan.status).toBe("failed");
    expect(await repos.dailyPlans.runningFor(user.id, NOW)).toBeNull();
    expect(await repos.aiRuns.countSucceededToday(user.id)).toBe(0);
  });
});

describe("enqueueNightlyPlans", () => {
  it("walks every account, enqueues the entitled active ones, and reports the rest", async () => {
    const repos = getTestRepos();
    const pro = await proUser(repos, "a-pro@example.com");
    await freeUser(repos, "b-free@example.com");
    const idle = await repos.users.create({
      email: "c-idle@example.com",
      displayName: "Idle",
      isCreator: false,
    });
    await repos.entitlements.upsert(idle.id, trialSnapshot(30, NOW));
    const stale = await repos.tasks.create(idle.id, { sourceText: "Old", sourceContext: null });
    // Age the only open task past the idle window.
    (repos as ReturnType<typeof getTestRepos>).__state().tasks.get(stale.id)!.updatedAt = new Date(
      NOW.getTime() - (IDLE_AFTER_DAYS + 1) * 86_400_000,
    ).toISOString();
    const empty = await repos.users.create({
      email: "d-empty@example.com",
      displayName: "Empty",
      isCreator: false,
    });
    await repos.entitlements.upsert(empty.id, trialSnapshot(30, NOW));

    const result = await enqueueNightlyPlans(repos, { now: NOW, offline: false, pageSize: 2 });
    expect(result).toEqual({
      users: 4,
      enqueued: 1,
      skipped: { notEntitled: 1, cap: 0, idle: 2, alreadyPlanned: 0, alreadyRunning: 0 },
      failed: 0,
      truncated: false,
    });
    expect(client.start).toHaveBeenCalledTimes(1);
    const plan = await repos.dailyPlans.latest(pro.id);
    expect(plan?.trigger).toBe("cron");
    expect(plan?.timezone).toBe("UTC");
    expect(plan?.planDate).toBe(planDateFor(NOW, "UTC", "cron"));

    // The same tick again: the cron claim makes it a no-op.
    const again = await enqueueNightlyPlans(repos, { now: NOW, offline: false });
    expect(again.enqueued).toBe(0);
    expect(again.skipped.alreadyRunning).toBe(1);
  });

  it("plans in the zone saved with the user's notification preferences", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos, "nz@example.com");
    await repos.notificationPreferences.upsert(user.id, {
      ...DEFAULT_PREFERENCES,
      timezone: "Pacific/Auckland",
    });
    const result = await enqueueNightlyPlans(repos, { now: NOW, offline: false });
    expect(result.enqueued).toBe(1);
    const plan = await repos.dailyPlans.latest(user.id);
    expect(plan?.timezone).toBe("Pacific/Auckland");
    expect(plan?.planDate).toBe(planDateFor(NOW, "Pacific/Auckland", "cron"));
  });

  it("stops at the time budget and says so", async () => {
    const repos = getTestRepos();
    await proUser(repos, "a@example.com");
    await proUser(repos, "b@example.com");
    const result = await enqueueNightlyPlans(repos, {
      now: NOW,
      offline: false,
      timeBudgetMs: -1,
    });
    expect(result.truncated).toBe(true);
    expect(result.users).toBe(0);
  });
});

describe("GET /api/cron/daily-plan", () => {
  async function get(authorization?: string) {
    const { GET } = await import("@/app/api/cron/daily-plan/route");
    return GET(
      new Request("http://localhost/api/cron/daily-plan", {
        headers: authorization ? { authorization } : {},
      }),
    );
  }

  it("refuses without the configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await get("Bearer anything")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "cron-secret-test");
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
  });

  it("enqueues the night's plans and reports counts", async () => {
    const repos = getTestRepos();
    await proUser(repos);
    const res = await get("Bearer cron-secret-test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(1);
    expect(client.start).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/plan and POST /api/plan/replan", () => {
  async function getPlan(cookie?: string) {
    const { GET } = await import("@/app/api/plan/route");
    return GET(new Request("http://localhost/api/plan", { headers: cookie ? { cookie } : {} }));
  }
  async function replan(cookie: string | undefined, body: Record<string, unknown> = {}) {
    const { POST } = await import("@/app/api/plan/replan/route");
    return POST(
      new Request("http://localhost/api/plan/replan", {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  }

  it("requires a session", async () => {
    expect((await getPlan()).status).toBe(401);
    expect((await replan(undefined)).status).toBe(401);
  });

  it("a Pro user re-plans today in their own zone and polls the running plan", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "replan@example.com" });
    await repos.tasks.create(user.id, { sourceText: "Open task", sourceContext: null });

    const before = await getPlan(cookie);
    expect(await before.json()).toEqual({ plan: null, running: false, canReplan: true });

    const res = await replan(cookie, { timeZone: "Pacific/Auckland" });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.runId).toBe("wrun_plan");
    expect(body.plan).toMatchObject({
      status: "running",
      trigger: "manual",
      timezone: "Pacific/Auckland",
    });
    expect(body.plan.userId).toBeUndefined();
    expect(body.plan.workflowRunId).toBeUndefined();

    const polled = await (await getPlan(cookie)).json();
    expect(polled.running).toBe(true);
    expect(polled.plan.id).toBe(body.plan.id);

    const again = await replan(cookie, { timeZone: "Pacific/Auckland" });
    expect(again.status).toBe(409);
  });

  it("maps the remaining refusals: 402 at the cap, 503 when the run cannot start, 409 already planned", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "edges@example.com" });
    await repos.tasks.create(user.id, { sourceText: "Open task", sourceContext: null });

    client.start.mockRejectedValueOnce(new Error("queue down"));
    const notStarted = await replan(cookie, { timeZone: "UTC" });
    expect(notStarted.status).toBe(503);
    expect((await notStarted.json()).plan.status).toBe("failed");

    const atCap = vi
      .spyOn(repos.aiRuns, "countSucceededToday")
      .mockResolvedValueOnce(PRO_FAIR_USE_SIFTS_PER_DAY);
    const capped = await replan(cookie, { timeZone: "UTC" });
    atCap.mockRestore();
    expect(capped.status).toBe(402);
    expect((await capped.json()).code).toBe("fair_use_cap");

    const planned = vi
      .spyOn(repos.dailyPlans, "claim")
      .mockResolvedValueOnce({ ok: false, reason: "planned" });
    const already = await replan(cookie, { timeZone: "UTC" });
    planned.mockRestore();
    expect(already.status).toBe(409);
    expect((await already.json()).error).toBe("Already planned today.");
  });

  it("rejects an unknown time zone and answers 402 for free accounts", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "free-replan@example.com",
    });
    expect((await replan(cookie, { timeZone: "Mars/Olympus" })).status).toBe(400);

    await repos.entitlements.upsert(user.id, emptySnapshot());
    const res = await replan(cookie, {});
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("pro_feature");
    expect((await (await getPlan(cookie)).json()).canReplan).toBe(false);
    expect(client.start).not.toHaveBeenCalled();
  });
});
