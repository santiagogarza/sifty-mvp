import { resolveProvider } from "@/lib/ai/provider";
import {
  FREE_SIFTS_PER_DAY,
  PRO_FAIR_USE_SIFTS_PER_DAY,
  TRIAL_DAYS,
  trialSnapshot,
} from "@/lib/entitlements/entitlements";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  // These tests seed many runs "just now"; raise the per-minute burst cap so
  // only the daily entitlement cap is under test.
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("triage"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function seedRuns(repos: ReturnType<typeof getTestRepos>, userId: string, n: number) {
  for (let i = 0; i < n; i += 1) {
    await repos.aiRuns.insert({
      userId,
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
}

async function postTriage(cookie: string, text: string) {
  const { POST } = await import("@/app/api/triage/route");
  return POST(
    new Request("http://localhost/api/triage", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ sourceText: text }),
    }),
  );
}

describe("AI cap enforcement", () => {
  it("free user at the free cap → 402 free_cap with an upgrade path", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "free@example.com",
      isCreator: false,
    });
    // Trial lapsed → free tier.
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(user.id, trialSnapshot(TRIAL_DAYS, started));
    await seedRuns(repos, user.id, FREE_SIFTS_PER_DAY);

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const res = await postTriage(cookie, "Test the free cap");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("free_cap");
    expect(body.error).toMatch(/upgrade to pro/i);
    expect(body.entitlement.tier).toBe("free");
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("free user under the cap is admitted", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "free2@example.com",
      isCreator: false,
    });
    const started = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await repos.entitlements.upsert(user.id, trialSnapshot(TRIAL_DAYS, started));
    await seedRuns(repos, user.id, FREE_SIFTS_PER_DAY - 1);

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const res = await postTriage(cookie, "One more sift");
    expect(res.status).toBe(200);
  });

  it("trialing user at the Pro fair-use ceiling → 402 fair_use_cap (live count from aiRuns)", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "trialer@example.com",
      isCreator: false,
    });
    await seedRuns(repos, user.id, PRO_FAIR_USE_SIFTS_PER_DAY);

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const res = await postTriage(cookie, "Test the cap");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe("fair_use_cap");
    expect(body.error).toMatch(/fair-use/i);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("creator account is never capped", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, {
      email: "s.gonzalez.garza@gmail.com",
      isCreator: true,
    });
    await seedRuns(repos, user.id, 1000);

    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happy,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const res = await postTriage(cookie, "Creator runs unlimited");
    expect(res.status).toBe(200);
  });
});
