import { listAiRuns } from "@/lib/ai/ai-runs";
import { AiConfigError, MissingAiKeyError, resolveProvider } from "@/lib/ai/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

vi.mock("ai", () => ({ generateObject: vi.fn() }));

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("plan"));
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

    // Preference reaches the plan stage; the run is attributed and priced.
    expect(resolveProvider).toHaveBeenLastCalledWith("plan", { preference: null });
    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.stage).toBe("plan");
    expect(runs[0]!.transport).toBe("gateway");
    expect(runs[0]!.model).toBe("anthropic/claude-sonnet-4.5");
    // 120 in @ $3/M + 60 out @ $15/M = $0.00126 = 0.126 cents.
    expect(runs[0]!.costCents).toBeCloseTo(0.126, 9);
  });

  it("forwards modelPreference, and the legacy modelId field, to the plan stage", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        objective: "O",
        context: [],
        steps: ["A", "B"],
        successCriteria: ["Done"],
        openQuestions: [],
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, { sourceText: "Do X", sourceContext: null });
    const { POST } = await import("@/app/api/agent-brief/route");

    expect((await POST(buildReq({ taskId: task.id, modelPreference: "fast" }))).status).toBe(200);
    expect(resolveProvider).toHaveBeenLastCalledWith("plan", { preference: "fast" });

    expect((await POST(buildReq({ taskId: task.id, modelId: "gpt-4o" }))).status).toBe(200);
    expect(resolveProvider).toHaveBeenLastCalledWith("plan", { preference: "gpt-4o" });
  });

  it("maps AI configuration errors to 503 with the error code and records no run", async () => {
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, { sourceText: "Do X", sourceContext: null });
    const { POST } = await import("@/app/api/agent-brief/route");

    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new MissingAiKeyError("AI_TRANSPORT=direct: ... OPENAI_API_KEY is not set.");
    });
    let res = await POST(buildReq({ taskId: task.id }));
    expect(res.status).toBe(503);
    let body = await res.json();
    expect(body.code).toBe("no_ai_key");
    expect(body.error).not.toContain("OPENAI_API_KEY");

    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new AiConfigError("AI_TRANSPORT must be one of ...");
    });
    res = await POST(buildReq({ taskId: task.id }));
    expect(res.status).toBe(503);
    body = await res.json();
    expect(body.code).toBe("ai_misconfigured");

    expect(await listAiRuns(userId)).toHaveLength(0);
    expect((await repos.tasks.get(userId, task.id))?.agentBrief).toBeNull();
  });

  it("records a failed run with stage plan when the model errors", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValue(new Error("model unavailable"));
    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, { sourceText: "Do X", sourceContext: null });
    const { POST } = await import("@/app/api/agent-brief/route");

    const res = await POST(buildReq({ taskId: task.id }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Brief generation failed — try again.");

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "failed",
      stage: "plan",
      transport: "unknown",
      error: "model unavailable",
      costCents: null,
    });
  });
});
