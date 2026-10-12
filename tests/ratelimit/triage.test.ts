import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

// Re-sift requests are gated before anything is enqueued; the workflow
// client is stubbed so an admitted request answers 202 without a runtime.
beforeEach(() => {
  __resetRateLimits();
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "3");
  setWorkflowClientForTesting({
    start: async () => ({ runId: "wrun_limit" }),
    wait: async () => ({ status: "pending" }),
    resume: async () => ({ ok: false, reason: "not_found" }),
  });
});

afterEach(() => {
  __resetRateLimits();
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function resiftRequest(userId: string, cookie: string) {
  const task = await getTestRepos().tasks.create(userId, {
    sourceText: "Test",
    sourceContext: null,
  });
  return new Request("http://localhost/api/triage", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ taskId: task.id }),
  });
}

describe("triage rate limit", () => {
  it("returns 429 with Retry-After once the per-minute cap is exceeded", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "limit@example.com",
      isCreator: false,
    });
    const { POST } = await import("@/app/api/triage/route");
    const fire = async () => POST(await resiftRequest(user.id, cookie));

    expect((await fire()).status).toBe(202);
    expect((await fire()).status).toBe(202);
    expect((await fire()).status).toBe(202);

    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("the persistent ai_runs window limits across instances (fresh in-memory bucket)", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "limit-db@example.com",
      isCreator: false,
    });

    const { POST } = await import("@/app/api/triage/route");
    const fire = async () => POST(await resiftRequest(user.id, cookie));

    expect((await fire()).status).toBe(202);
    expect((await fire()).status).toBe(202);
    expect((await fire()).status).toBe(202);

    // Simulate a different serverless instance: local buckets are empty,
    // but the recorded sifts (one accounting row each) still gate the request.
    __resetRateLimits();
    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    // Same body shape as the bucket 429 so every client reads one thing
    // (plus the task, now marked failed with the same message).
    expect(await limited.json()).toMatchObject({
      error: "Too many AI requests. Slow down a bit.",
      message: "Too many AI requests. Slow down a bit.",
      code: "rate_limited",
    });
  });
});
