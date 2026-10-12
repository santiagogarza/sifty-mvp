import { decisionHookToken } from "@/lib/decisions/hook";
import { openClarifyingQuestion } from "@/lib/decisions/service";
import { DECISION_LIMITS } from "@/lib/domain/limits";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { siftTask } from "@/lib/workflows/sift-task";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * The Decisions API against the in-memory repos, with the workflow client
 * stubbed: the routes must resolve the decision exactly once, wake the run
 * that asked, and fall back to a fresh sift when no run is waiting.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

let cookie: string;
let userId: string;
let otherCookie: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  __resetRateLimits();
  client.start.mockReset().mockResolvedValue({ runId: "wrun_fallback" });
  client.resume.mockReset().mockResolvedValue({ ok: true, runId: "wrun_asked" });
  setWorkflowClientForTesting(client);
  const repos = getTestRepos();
  const me = await createUserWithCookie(repos, { email: "decider@example.com" });
  cookie = me.cookie;
  userId = me.user.id;
  const other = await createUserWithCookie(repos, { email: "other@example.com" });
  otherCookie = other.cookie;
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function seedQuestion(opts: { options?: string[] } = {}) {
  const repos = getTestRepos();
  const task = await repos.tasks.create(userId, { sourceText: "Taxes", sourceContext: null });
  await repos.tasks.update(userId, task.id, {
    siftId: "sift_q",
    aiStatus: "ready",
    confidence: 0.4,
    clarifyingQuestion: "What outcome would mark this as done?",
  });
  const decision = await openClarifyingQuestion(repos, userId, {
    id: "dec_q",
    taskId: task.id,
    siftId: "sift_q",
    question: "What outcome would mark this as done?",
    options: opts.options ?? ["A decision", "Something sent"],
    confidence: 0.4,
  });
  return { repos, task, decision };
}

async function list(headers: Record<string, string> = { cookie }) {
  const { GET } = await import("@/app/api/decisions/route");
  return GET(new Request("http://localhost/api/decisions", { headers }));
}

async function answer(
  id: string,
  body: Record<string, unknown> | null,
  headers: Record<string, string> = { cookie },
) {
  const { POST } = await import("@/app/api/decisions/[id]/answer/route");
  return POST(
    new Request(`http://localhost/api/decisions/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === null ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function dismiss(id: string, headers: Record<string, string> = { cookie }) {
  const { POST } = await import("@/app/api/decisions/[id]/dismiss/route");
  return POST(
    new Request(`http://localhost/api/decisions/${id}/dismiss`, { method: "POST", headers }),
    { params: Promise.resolve({ id }) },
  );
}

describe("GET /api/decisions", () => {
  it("requires a session", async () => {
    expect((await list({})).status).toBe(401);
  });

  it("lists open decisions newest first with the tasks they are about", async () => {
    const { task, decision } = await seedQuestion();
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      id: decision.id,
      status: "open",
      payload: { question: "What outcome would mark this as done?" },
    });
    expect(body.tasks).toEqual([
      { id: task.id, title: "Taxes", sourceText: "Taxes", lifecycle: "inbox" },
    ]);
    // Another tenant sees an empty inbox.
    const theirs = await (await list({ cookie: otherCookie })).json();
    expect(theirs).toEqual({ decisions: [], tasks: [], count: 0 });
  });
});

describe("POST /api/decisions/:id/answer", () => {
  it("401 without a session, 404 for another tenant's decision or an unknown id", async () => {
    const { decision } = await seedQuestion();
    expect((await answer(decision.id, { text: "x" }, {})).status).toBe(401);
    expect((await answer(decision.id, { text: "x" }, { cookie: otherCookie })).status).toBe(404);
    expect((await answer("dec_nope", { text: "x" })).status).toBe(404);
    // Nothing was resolved or resumed.
    expect((await getTestRepos().decisions.get(userId, decision.id))?.status).toBe("open");
    expect(client.resume).not.toHaveBeenCalled();
  });

  it("400 for an empty answer, an unknown field, or an oversized answer", async () => {
    const { decision } = await seedQuestion();
    expect((await answer(decision.id, {})).status).toBe(400);
    expect((await answer(decision.id, { text: "   " })).status).toBe(400);
    expect((await answer(decision.id, { nope: 1 })).status).toBe(400);
    expect(
      (await answer(decision.id, { text: "x".repeat(DECISION_LIMITS.answerText + 1) })).status,
    ).toBe(400);
    expect(
      (await answer(decision.id, { option: "y".repeat(DECISION_LIMITS.option + 1) })).status,
    ).toBe(400);
    // Nothing above resolved it; the limit itself is accepted.
    expect((await getTestRepos().decisions.get(userId, decision.id))?.status).toBe("open");
    expect(
      (await answer(decision.id, { text: "x".repeat(DECISION_LIMITS.answerText) })).status,
    ).toBe(200);
  });

  it("resolves the decision, wakes the run that asked, and puts the task back in motion", async () => {
    const { repos, task, decision } = await seedQuestion();
    const res = await answer(decision.id, { option: "A decision", text: "Pick an accountant" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("resumed");
    expect(body.decision.status).toBe("answered");
    expect(body.decision.answer).toEqual({
      text: "Pick an accountant",
      option: "A decision",
      via: "app",
    });
    expect(body.task.aiStatus).toBe("pending");
    expect(body.task.clarifyingQuestion).toBeNull();

    expect(client.resume).toHaveBeenCalledWith(decisionHookToken(decision.id), {
      status: "answered",
      answer: { text: "Pick an accountant", option: "A decision", via: "app" },
    });
    // The run folds the answer in; the route did not start a second sift.
    expect(client.start).not.toHaveBeenCalled();
    const stored = await repos.tasks.get(userId, task.id);
    expect(stored?.siftId).toBe("sift_q");
    expect(stored?.sourceContext).toBeNull();
  });

  it("409 on a second answer: the first one won", async () => {
    const { decision } = await seedQuestion();
    expect((await answer(decision.id, { text: "first" })).status).toBe(200);
    const again = await answer(decision.id, { text: "second" });
    expect(again.status).toBe(409);
    const body = await again.json();
    expect(body.decision.status).toBe("answered");
    expect(body.decision.answer.text).toBe("first");
    expect(client.resume).toHaveBeenCalledTimes(1);
  });

  it("falls back to folding the answer in and starting a new sift when no run is waiting", async () => {
    client.resume.mockResolvedValue({ ok: false, reason: "not_found" });
    const { repos, task, decision } = await seedQuestion();
    const res = await answer(decision.id, { text: "File the federal return by Friday" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("resifted");
    expect(body.sift).toEqual({ runId: "wrun_fallback" });
    expect(body.task.aiStatus).toBe("pending");
    expect(body.task.siftId).not.toBe("sift_q");

    expect(client.start).toHaveBeenCalledTimes(1);
    const [fn, args] = client.start.mock.calls[0]!;
    expect(fn).toBe(siftTask);
    expect(args[0]).toMatchObject({ taskId: task.id, userId });
    const stored = await repos.tasks.get(userId, task.id);
    expect(stored?.sourceContext).toBe("Answer: File the federal return by Friday");
    expect(stored?.clarifyingQuestion).toBeNull();
    expect((await repos.decisions.get(userId, decision.id))?.status).toBe("answered");
  });

  it("still records the answer when the hook resume throws", async () => {
    client.resume.mockRejectedValue(new Error("world down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { decision } = await seedQuestion();
    const res = await answer(decision.id, { text: "noted" });
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("resifted");
    expect((await getTestRepos().decisions.get(userId, decision.id))?.status).toBe("answered");
  });
});

describe("POST /api/decisions/:id/dismiss", () => {
  it("401 / 404 / 409 like answer", async () => {
    const { decision } = await seedQuestion();
    expect((await dismiss(decision.id, {})).status).toBe(401);
    expect((await dismiss(decision.id, { cookie: otherCookie })).status).toBe(404);
    expect((await dismiss("dec_nope")).status).toBe(404);
    expect((await dismiss(decision.id)).status).toBe(200);
    expect((await dismiss(decision.id)).status).toBe(409);
  });

  it("marks the task sifted-with-assumptions, clears the question, and releases the run", async () => {
    const { repos, task, decision } = await seedQuestion();
    const res = await dismiss(decision.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision.status).toBe("dismissed");
    expect(body.task).toMatchObject({
      id: task.id,
      clarifyingQuestion: null,
      siftedWithAssumptions: true,
      aiStatus: "ready",
    });
    expect(client.resume).toHaveBeenCalledWith(decisionHookToken(decision.id), {
      status: "dismissed",
    });
    expect(client.start).not.toHaveBeenCalled();
    expect((await repos.decisions.listOpen(userId)).length).toBe(0);
  });

  it("leaves the task alone when a newer sift already owns it", async () => {
    const { repos, task, decision } = await seedQuestion();
    await repos.tasks.update(userId, task.id, { siftId: "sift_newer" });
    const body = await (await dismiss(decision.id)).json();
    expect(body.decision.status).toBe("dismissed");
    expect(body.task.siftedWithAssumptions).toBe(false);
  });
});

describe("decisions follow the task", () => {
  it("a re-sift expires the previous sift's open question and releases its run", async () => {
    const { repos, task, decision } = await seedQuestion();
    const { POST } = await import("@/app/api/triage/route");
    const res = await POST(
      new Request("http://localhost/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ taskId: task.id }),
      }),
    );
    expect(res.status).toBe(202);
    expect((await repos.decisions.get(userId, decision.id))?.status).toBe("expired");
    expect(client.resume).toHaveBeenCalledWith(decisionHookToken(decision.id), {
      status: "expired",
    });
    expect(await repos.decisions.countOpen(userId)).toBe(0);
  });

  it("deleting the task releases the run before the decision is cascaded away", async () => {
    const { repos, task, decision } = await seedQuestion();
    const { DELETE } = await import("@/app/api/tasks/[id]/route");
    const res = await DELETE(
      new Request(`http://localhost/api/tasks/${task.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(res.status).toBe(200);
    expect(client.resume).toHaveBeenCalledWith(decisionHookToken(decision.id), {
      status: "expired",
    });
    expect(await repos.decisions.get(userId, decision.id)).toBeNull();
  });
});
