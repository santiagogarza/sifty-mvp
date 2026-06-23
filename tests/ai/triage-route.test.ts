import { listAiRuns } from "@/lib/ai/ai-runs";
import { MissingAiKeyError, resolveProvider } from "@/lib/ai/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

// We mock the AI SDK's `generateObject` and the provider resolver so the
// route exercises every part of its contract — input validation,
// entitlement gating, error mapping, aiRuns persistence — without ever
// reaching out over the network. The model itself is not under test here.
vi.mock("ai", () => ({ generateObject: vi.fn() }));

vi.mock("@/lib/ai/provider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/provider")>("@/lib/ai/provider");
  return { ...actual, resolveProvider: vi.fn() };
});

const happyOutput = {
  title: "Draft email to investor",
  description: null,
  nextAction: "Open editor and write the first paragraph",
  urgency: 0.8,
  importance: 0.7,
  effort: "medium",
  dueHint: "2026-07-01",
  delegationCandidate: "self",
  suggestedLabels: ["Work"],
  subtasks: [],
  rationale: "model rationale",
  confidence: 0.8,
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

async function importRoute() {
  const mod = await import("@/app/api/triage/route");
  return mod.POST;
}

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("CREATOR_EMAIL", "creator@example.com");

  vi.mocked(resolveProvider).mockReturnValue({
    model: { __mock: true } as unknown as ReturnType<typeof resolveProvider>["model"],
    transport: "mock",
    option: mockOption,
  });
  const { generateObject } = await import("ai");
  vi.mocked(generateObject).mockReset();

  const created = await createUserWithCookie(getTestRepos(), {
    email: "regular@example.com",
    isCreator: false,
  });
  cookie = created.cookie;
  userId = created.user.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function buildReq(body: unknown, opts?: { offline?: boolean; cookie?: string | null }) {
  const url = `http://localhost/api/triage${opts?.offline ? "?offline=1" : ""}`;
  const headers: HeadersInit = { "content-type": "application/json" };
  if (opts?.cookie !== null) headers.cookie = opts?.cookie ?? cookie;
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/triage", () => {
  it("rejects malformed bodies with 400", async () => {
    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid body");
  });

  it("returns 401 when not signed in", async () => {
    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email" }, { cookie: null }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with schema-valid output and writes an aiRuns row", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happyOutput,
      usage: { inputTokens: 200_000, outputTokens: 80_000 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const POST = await importRoute();
    const res = await POST(
      buildReq({
        taskId: "task_1",
        sourceText: "Draft email to investor by tomorrow",
        modelId: "claude-haiku",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output.title).toBe("Draft email to investor");
    expect(body.meta.offline).toBe(false);
    expect(body.meta.transport).toBe("mock");
    expect(body.meta.inputTokens).toBe(200_000);
    expect(body.meta.outputTokens).toBe(80_000);
    expect(body.meta.costCents).toBeGreaterThan(0);

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.taskId).toBe("task_1");
    expect(runs[0]!.model).toContain("claude-haiku");
  });

  it("returns 503 when no AI key is configured", async () => {
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new MissingAiKeyError("Anthropic provider selected, but no key set.");
    });

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email", modelId: "claude-haiku" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("no_ai_key");

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(0);
  });

  it("surfaces model errors as 500 and writes a failed aiRuns row", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValue(new Error("model unavailable"));

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email", modelId: "claude-haiku" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("model unavailable");

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).toBe("model unavailable");
  });

  it("offline=1 query param uses the heuristic and never calls the model", async () => {
    const { generateObject } = await import("ai");
    const POST = await importRoute();
    const res = await POST(
      buildReq({ sourceText: "Draft email to investor by tomorrow" }, { offline: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.offline).toBe(true);
    expect(body.meta.model).toContain("heuristic");
    expect(generateObject).not.toHaveBeenCalled();
  });
});
