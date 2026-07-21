import { resolveProvider } from "@/lib/ai/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const mockOption = {
  id: "claude-haiku",
  gatewaySlug: "anthropic/claude-haiku-4-5",
  provider: "anthropic" as const,
  label: "Claude Haiku",
  description: "Fast.",
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 5,
};

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

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  // These tests seed many runs "just now"; raise the per-minute burst cap so
  // only the daily entitlement cap is under test.
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  vi.mocked(resolveProvider).mockReturnValue({
    model: { __mock: true } as unknown as ReturnType<typeof resolveProvider>["model"],
    transport: "mock",
    option: mockOption,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI cap enforcement", () => {
  it("returns 402 when the user has hit their daily cap (live count from aiRuns)", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "trialer@example.com",
      isCreator: false,
    });

    // Seed 50 succeeded aiRuns today (the trialing tier cap).
    for (let i = 0; i < 50; i += 1) {
      await repos.aiRuns.insert({
        userId: user.id,
        taskId: null,
        promptVersion: "triage.v1",
        model: "anthropic/claude-haiku-4-5",
        transport: "gateway",
        status: "succeeded",
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 20,
        costCents: 1,
        offline: false,
        error: null,
      });
    }

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const { POST } = await import("@/app/api/triage/route");
    const res = await POST(
      new Request("http://localhost/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ sourceText: "Test the cap" }),
      }),
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/cap reached/i);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("creator account is never capped", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    for (let i = 0; i < 1000; i += 1) {
      await repos.aiRuns.insert({
        userId: user.id,
        taskId: null,
        promptVersion: "triage.v1",
        model: "anthropic/claude-haiku-4-5",
        transport: "gateway",
        status: "succeeded",
        durationMs: 100,
        inputTokens: 10,
        outputTokens: 20,
        costCents: 1,
        offline: false,
        error: null,
      });
    }

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const { POST } = await import("@/app/api/triage/route");
    const res = await POST(
      new Request("http://localhost/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ sourceText: "Creator runs unlimited" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
