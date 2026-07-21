import { resolveProvider } from "@/lib/ai/provider";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const happy = {
  title: "T",
  description: null,
  nextAction: null,
  urgency: 0.4,
  importance: 0.4,
  effort: "small",
  dueHint: null,
  delegationCandidate: "self",
  suggestedLabels: [],
  subtasks: [],
  rationale: null,
  confidence: 0.7,
  clarifyingQuestion: null,
};

const mockOption = {
  id: "claude-haiku",
  gatewaySlug: "anthropic/claude-haiku-4-5",
  provider: "anthropic" as const,
  label: "Claude Haiku",
  description: "Fast.",
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
};

beforeEach(() => {
  __resetRateLimits();
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "3");
  vi.mocked(resolveProvider).mockReturnValue({
    model: { __mock: true } as unknown as ReturnType<typeof resolveProvider>["model"],
    transport: "mock",
    option: mockOption,
  });
});

afterEach(() => {
  __resetRateLimits();
  vi.unstubAllEnvs();
});

describe("triage rate limit", () => {
  it("returns 429 with Retry-After once the per-minute cap is exceeded", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "limit@example.com",
      isCreator: false,
    });
    void user;

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const { POST } = await import("@/app/api/triage/route");

    const fire = () =>
      POST(
        new Request("http://localhost/api/triage", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ sourceText: "Test" }),
        }),
      );

    expect((await fire()).status).toBe(200);
    expect((await fire()).status).toBe(200);
    expect((await fire()).status).toBe(200);

    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("the persistent ai_runs window limits across instances (fresh in-memory bucket)", async () => {
    const { user, cookie } = await createUserWithCookie(getTestRepos(), {
      email: "limit-db@example.com",
      isCreator: false,
    });

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const { POST } = await import("@/app/api/triage/route");
    const fire = () =>
      POST(
        new Request("http://localhost/api/triage", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ sourceText: "Test" }),
        }),
      );

    expect((await fire()).status).toBe(200);
    expect((await fire()).status).toBe(200);
    expect((await fire()).status).toBe(200);

    // Simulate a different serverless instance: local buckets are empty,
    // but the recorded runs still gate the request.
    __resetRateLimits();
    const limited = await fire();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    void user;
  });
});
