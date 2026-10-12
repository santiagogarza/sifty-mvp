import { listAiRuns } from "@/lib/ai/ai-runs";
import { AiConfigError, MissingAiKeyError, resolveProvider } from "@/lib/ai/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockResolvedProvider } from "../helpers/ai";
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

async function importRoute() {
  const mod = await import("@/app/api/triage/route");
  return mod.POST;
}

let cookie: string;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("CREATOR_EMAIL", "creator@example.com");

  vi.mocked(resolveProvider).mockReturnValue(mockResolvedProvider("triage"));
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
        modelPreference: "recommended",
      }),
    );
    expect(res.status).toBe(200);
    expect(resolveProvider).toHaveBeenLastCalledWith("triage", { preference: "recommended" });
    const body = await res.json();
    expect(body.output.title).toBe("Draft email to investor");
    expect(body.meta.offline).toBe(false);
    expect(body.meta.transport).toBe("gateway");
    expect(body.meta.stage).toBe("triage");
    expect(body.meta.inputTokens).toBe(200_000);
    expect(body.meta.outputTokens).toBe(80_000);
    expect(body.meta.costCents).toBeGreaterThan(0);

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.taskId).toBe("task_1");
    expect(runs[0]!.model).toBe("anthropic/claude-haiku-4.5");
    expect(runs[0]!.stage).toBe("triage");
    // 200k in @ $1/M + 80k out @ $5/M = $0.60 = 60 cents.
    expect(runs[0]!.costCents).toBeCloseTo(60, 6);
  });

  it("returns 503 no_ai_key when the transport's key is missing", async () => {
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new MissingAiKeyError("AI_TRANSPORT=gateway requires AI_GATEWAY_API_KEY.");
    });

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email", modelPreference: "recommended" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("no_ai_key");
    // The variable name stays in the server log, not in the client payload.
    expect(body.error).not.toContain("AI_GATEWAY_API_KEY");

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(0);
  });

  it("returns 503 ai_misconfigured for an invalid AI_TRANSPORT", async () => {
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new AiConfigError('AI_TRANSPORT must be one of "gateway", "direct" (got "bogus").');
    });

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email" }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("ai_misconfigured");
  });

  it("accepts the legacy modelId field as a preference", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happyOutput,
      usage: { inputTokens: 100, outputTokens: 50 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email", modelId: "claude-sonnet" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(resolveProvider)).toHaveBeenCalledWith("triage", {
      preference: "claude-sonnet",
    });
  });

  it("surfaces model errors as a sanitized 500 and writes a failed aiRuns row", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockRejectedValue(new Error("model unavailable"));

    const POST = await importRoute();
    const res = await POST(buildReq({ sourceText: "Draft email", modelPreference: "recommended" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    // Provider detail never reaches the client; it lives in ai_runs.
    expect(body.error).toBe("Triage failed — try again.");

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).toBe("model unavailable");
    expect(runs[0]!.stage).toBe("triage");
    expect(runs[0]!.transport).toBe("unknown");
    expect(runs[0]!.costCents).toBeNull();
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

  it("SIFTY_AI_OFFLINE=1 works with no transport configured and never resolves a provider", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("SIFTY_AI_OFFLINE", "1");
    vi.mocked(resolveProvider).mockReset();
    vi.mocked(resolveProvider).mockImplementation(() => {
      throw new MissingAiKeyError("should not be called");
    });

    const POST = await importRoute();
    const res = await POST(buildReq({ taskId: "task_off", sourceText: "Call the bank tomorrow" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.offline).toBe(true);
    expect(body.meta.transport).toBe("offline");
    expect(resolveProvider).not.toHaveBeenCalled();

    const runs = await listAiRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.transport).toBe("offline");
    expect(runs[0]!.stage).toBe("triage");
    expect(runs[0]!.costCents).toBeNull();
  });

  it("applies the result to the server task durably, linking suggested labels", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happyOutput,
      usage: { inputTokens: 100, outputTokens: 50 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Draft email to investor by tomorrow",
      sourceContext: null,
    });

    const POST = await importRoute();
    const res = await POST(
      buildReq({
        taskId: task.id,
        sourceText: task.sourceText,
        modelPreference: "recommended",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Response carries the canonical applied task + the labels it links.
    expect(body.task.id).toBe(task.id);
    expect(body.task.aiStatus).toBe("ready");
    expect(body.task.title).toBe("Draft email to investor");
    expect(body.labels).toHaveLength(1);
    expect(body.labels[0].name).toBe("Work");
    expect(body.task.labelIds).toEqual([body.labels[0].id]);

    // And it is persisted, not just echoed.
    const persisted = await repos.tasks.get(userId, task.id);
    expect(persisted?.aiStatus).toBe("ready");
    expect(persisted?.title).toBe("Draft email to investor");
    expect(persisted?.due).toBe("2026-07-01");
    expect(persisted?.labelIds).toEqual([body.labels[0].id]);
  });

  it("server-side apply never overwrites user-edited fields", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happyOutput,
      usage: { inputTokens: 100, outputTokens: 50 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const repos = getTestRepos();
    const task = await repos.tasks.create(userId, {
      sourceText: "Draft email to investor by tomorrow",
      sourceContext: null,
    });
    await repos.tasks.update(
      userId,
      task.id,
      { title: "My own title", urgency: 0.1 },
      { editedFields: ["title", "urgency"] },
    );

    const POST = await importRoute();
    const res = await POST(buildReq({ taskId: task.id, sourceText: task.sourceText }));
    expect(res.status).toBe(200);

    const persisted = await repos.tasks.get(userId, task.id);
    expect(persisted?.title).toBe("My own title");
    expect(persisted?.urgency).toBe(0.1);
    // Unprotected fields still update.
    expect(persisted?.nextAction).toBe(happyOutput.nextAction);
    expect(persisted?.aiStatus).toBe("ready");
  });

  it("returns task: null when the task does not exist server-side (client applies locally)", async () => {
    const { generateObject } = await import("ai");
    vi.mocked(generateObject).mockResolvedValue({
      object: happyOutput,
      usage: { inputTokens: 100, outputTokens: 50 },
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const POST = await importRoute();
    const res = await POST(buildReq({ taskId: "task_never_pushed", sourceText: "Draft email" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBeNull();
    expect(body.output.title).toBe("Draft email to investor");
  });
});
