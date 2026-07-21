import { listAiRuns } from "@/lib/ai/ai-runs";
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

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.mocked(resolveProvider).mockReturnValue({
    model: { __mock: true } as unknown as ReturnType<typeof resolveProvider>["model"],
    transport: "mock",
    option: mockOption,
  });
  const created = await createUserWithCookie(getTestRepos(), { email: "brief@example.com" });
  cookie = created.cookie;
  userId = created.user.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function buildReq(body: unknown, opts?: { offline?: boolean }) {
  return new Request(`http://localhost/api/agent-brief${opts?.offline ? "?offline=1" : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent-brief", () => {
  it("404s for a task that is not on the server", async () => {
    const { POST } = await import("@/app/api/agent-brief/route");
    const res = await POST(buildReq({ taskId: "task_missing" }));
    expect(res.status).toBe(404);
  });

  it("generates, persists, and records the brief (offline template path)", async () => {
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Investigate streaming SSR options for the dashboard",
      sourceContext: "Hydration is slow on iOS Safari.",
    });

    const { POST } = await import("@/app/api/agent-brief/route");
    const res = await POST(buildReq({ taskId: task.id }, { offline: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brief).toContain("## Objective");
    expect(body.brief).toContain("## Steps");
    expect(body.task.agentBrief).toBe(body.brief);

    const persisted = await repos.tasks.get(userId, task.id);
    expect(persisted?.agentBrief).toBe(body.brief);

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.taskId).toBe(task.id);
  });

  it("composes markdown from the structured model output (online path)", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        objective: "Evaluate streaming SSR and recommend one approach.",
        context: ["Next.js 15 App Router."],
        steps: ["Profile hydration.", "Prototype streaming on Today."],
        successCriteria: ["A go/no-go recommendation."],
        openQuestions: [],
      },
      usage: { inputTokens: 120, outputTokens: 60 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Investigate streaming SSR options",
      sourceContext: null,
    });

    const { POST } = await import("@/app/api/agent-brief/route");
    const res = await POST(buildReq({ taskId: task.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brief).toContain("Evaluate streaming SSR and recommend one approach.");
    expect(body.brief).toContain("1. Profile hydration.");
    expect(body.brief).toContain("## Success criteria");
  });
});
