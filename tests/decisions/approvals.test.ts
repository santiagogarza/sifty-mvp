import type { Session } from "@/lib/auth/session";
import { confirmCopy, countByKind } from "@/lib/decisions/copy";
import { executionDecisionLinks, verifyDecisionLinkToken } from "@/lib/decisions/links";
import { awaySummary } from "@/lib/decisions/service";
import type { Decision } from "@/lib/domain/types";
import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { APPROVE_OPTION, REJECT_OPTION } from "@/lib/executions/copy";
import { researchExecutor } from "@/lib/executions/executors";
import {
  enqueueExecution,
  openApprovalDecision,
  openDraftReviewDecision,
} from "@/lib/executions/service";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Decisions v2 glue: the away summary the digest reads, the one-tap link
 * set for approvals, the confirm-page wording per kind, and the inbox
 * answer / dismiss / link routes acting on execution decisions.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

beforeEach(() => {
  vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "100000");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  __resetRateLimits();
  client.start.mockReset().mockResolvedValue({ runId: "wrun_x" });
  client.resume.mockReset().mockResolvedValue({ ok: true, runId: "wrun_x" });
  setWorkflowClientForTesting(client);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function proUser(email = "approver@example.com") {
  const repos = getTestRepos();
  const { user, cookie } = await createUserWithCookie(repos, { email });
  const entitlement = { ...emptySnapshot(), tier: "pro" as const, subscriptionActive: true };
  await repos.entitlements.upsert(user.id, entitlement);
  const session: Session = { user, entitlement, sessionId: null };
  return { repos, user, cookie, session };
}

/** An execution parked on a draft review, the way the workflow leaves it. */
async function parkedDraft(session: Session, title = "Lease") {
  const repos = getTestRepos();
  const created = await repos.tasks.create(session.user.id, {
    sourceText: title,
    sourceContext: null,
  });
  const task = (await repos.tasks.update(session.user.id, created.id, {
    title,
    aiStatus: "ready",
  }))!;
  const result = await enqueueExecution({ session, task, offline: true, modelPreference: null });
  if (!result.ok) throw new Error(result.reason);
  await repos.executions.transition(session.user.id, result.execution.id, {
    from: ["queued"],
    to: "running",
  });
  const decision = await openDraftReviewDecision(repos, session.user.id, {
    id: `dec_${result.execution.id}`,
    execution: result.execution,
    executor: researchExecutor,
    summary: `Research notes for “${title}”`,
    draft: { title: `Notes: ${title}`, body: "- Read it", format: "markdown" },
  });
  await repos.executions.transition(session.user.id, result.execution.id, {
    from: ["running"],
    to: "drafted",
    patch: { decisionId: decision.id },
  });
  return { task, execution: result.execution, decision };
}

describe("awaySummary", () => {
  it("counts what waits by kind and what executions did since a moment", async () => {
    const { repos, session, user } = await proUser();
    const since = new Date(Date.now() - 60_000);
    const a = await parkedDraft(session, "Lease");
    const b = await parkedDraft(session, "Vendor");
    // One finished, one rejected.
    await repos.decisions.resolve(user.id, b.decision.id, {
      status: "answered",
      answer: { text: null, option: APPROVE_OPTION, via: "app" },
    });
    await repos.executions.transition(user.id, b.execution.id, { from: ["drafted"], to: "done" });
    const c = await parkedDraft(session, "Audit");
    await repos.executions.transition(user.id, c.execution.id, {
      from: ["drafted"],
      to: "cancelled",
      patch: { cancelReason: "rejected" },
    });
    await repos.decisions.resolve(user.id, c.decision.id, { status: "dismissed", answer: null });
    // A plain approval gate too.
    const gateTask = await repos.tasks.create(user.id, { sourceText: "Gate", sourceContext: null });
    const gate = await repos.executions.create(user.id, {
      taskId: gateTask.id,
      executor: "research",
      policy: "ask_first",
      connector: null,
      idempotencyKey: "gate",
    });
    await openApprovalDecision(repos, user.id, {
      id: "dec_gate",
      execution: gate.execution,
      executor: researchExecutor,
      action: "Research it",
      question: "Research it?",
      options: [APPROVE_OPTION, REJECT_OPTION],
      reason: "ask_first",
      estimateCents: 5,
    });
    await repos.executions.transition(user.id, gate.execution.id, {
      from: ["queued"],
      to: "needs_approval",
      patch: { decisionId: "dec_gate" },
    });

    const summary = await awaySummary(user.id, { since });
    expect(summary.waiting).toEqual({
      total: 2,
      clarifying_question: 0,
      memory_proposal: 0,
      approval: 1,
      draft_review: 1,
    });
    expect(summary.executions).toEqual({
      done: 1,
      drafted: 1,
      needsApproval: 1,
      needsDecision: 0,
      failed: 0,
      cancelled: 1,
      running: 0,
    });
    expect(summary.since).toBe(since.toISOString());
    void a;

    // Another tenant: nothing.
    const other = await proUser("someone-else@example.com");
    const theirs = await awaySummary(other.user.id, { since });
    expect(theirs.waiting.total).toBe(0);
    expect(Object.values(theirs.executions).every((n) => n === 0)).toBe(true);
  });

  it("countByKind tallies a mixed list", () => {
    const d = (kind: Decision["kind"]) => ({ kind }) as Decision;
    expect(
      countByKind([d("approval"), d("draft_review"), d("approval"), d("memory_proposal")]),
    ).toEqual({
      clarifying_question: 0,
      memory_proposal: 1,
      approval: 2,
      draft_review: 1,
    });
  });
});

describe("executionDecisionLinks and confirmCopy", () => {
  it("builds open / approve / reject from the v1 token kinds", async () => {
    const links = await executionDecisionLinks("https://sifty.app", {
      userId: "user_1",
      decisionId: "dec_1",
    });
    const token = (url: string) => new URL(url).searchParams.get("token");
    expect(await verifyDecisionLinkToken(token(links.open))).toMatchObject({
      ok: true,
      claims: { decisionId: "dec_1", link: { action: "open" } },
    });
    expect(await verifyDecisionLinkToken(token(links.approve))).toMatchObject({
      ok: true,
      claims: { link: { action: "answer", option: APPROVE_OPTION } },
    });
    expect(await verifyDecisionLinkToken(token(links.reject))).toMatchObject({
      ok: true,
      claims: { link: { action: "dismiss" } },
    });
  });

  it("words the one-button page for what the tap does", () => {
    expect(confirmCopy({ action: "answer", option: APPROVE_OPTION }, "draft_review")).toEqual({
      label: "Approve",
      question: "Approve this draft as Sifty wrote it? To edit it first, open it in Sifty.",
    });
    expect(confirmCopy({ action: "answer", option: APPROVE_OPTION }, "approval").label).toBe(
      "Approve",
    );
    expect(confirmCopy({ action: "answer", option: REJECT_OPTION }, "approval").label).toBe(
      "Reject",
    );
    expect(confirmCopy({ action: "dismiss" }, "draft_review").label).toBe("Reject");
    expect(confirmCopy({ action: "dismiss" }, "memory_proposal").label).toBe("Not this");
    expect(confirmCopy({ action: "answer", option: "Remember" }, "memory_proposal").label).toBe(
      "Remember",
    );
    expect(confirmCopy({ action: "dismiss" }, "clarifying_question").label).toBe(
      "Let Sifty decide",
    );
    expect(confirmCopy({ action: "answer", option: "2026" }, "clarifying_question").label).toBe(
      "Answer “2026”",
    );
    expect(confirmCopy({ action: "answer", option: "2026" }, null).label).toBe("Answer “2026”");
  });
});

describe("routes acting on execution decisions", () => {
  async function answerRoute(id: string, body: Record<string, unknown>, cookie: string) {
    const { POST } = await import("@/app/api/decisions/[id]/answer/route");
    return POST(
      new Request(`http://localhost/api/decisions/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("approve with an edited draft finishes the execution; the inbox lists byKind", async () => {
    const { session, cookie, repos, user } = await proUser();
    const { execution, decision } = await parkedDraft(session);
    const { GET } = await import("@/app/api/decisions/route");
    const listed = await (
      await GET(new Request("http://localhost/api/decisions", { headers: { cookie } }))
    ).json();
    expect(listed.byKind).toMatchObject({ draft_review: 1 });
    expect(listed.decisions[0]).toMatchObject({
      kind: "draft_review",
      payload: { executionId: execution.id },
    });

    const res = await answerRoute(
      decision.id,
      { option: APPROVE_OPTION, draft: { title: "Better", body: "- Read it twice" } },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("execution");
    expect(body.execution).toMatchObject({
      mode: "edited",
      execution: {
        status: "done",
        result: { draft: { title: "Better", body: "- Read it twice" } },
      },
    });
    expect(body.task?.id).toBe(execution.taskId);
    expect((await repos.executions.get(user.id, execution.id))?.status).toBe("done");
    // The second answer loses the CAS.
    expect((await answerRoute(decision.id, { option: APPROVE_OPTION }, cookie)).status).toBe(409);
  });

  it("a wrong answer for a draft review is a 400 with a kind-specific message", async () => {
    const { session, cookie } = await proUser();
    const { decision } = await parkedDraft(session);
    const res = await answerRoute(decision.id, { text: "looks fine" }, cookie);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/approved \(with or without edits\) or rejected/);
    const tooBig = await answerRoute(
      decision.id,
      { option: APPROVE_OPTION, draft: { body: "x".repeat(20_001) } },
      cookie,
    );
    expect(tooBig.status).toBe(400);
  });

  it("the one-tap link approves and rejects execution decisions with the right redirect", async () => {
    const { session, cookie, repos, user } = await proUser();
    const a = await parkedDraft(session, "First");
    const b = await parkedDraft(session, "Second");
    const linksA = await executionDecisionLinks("http://localhost:3000", {
      userId: user.id,
      decisionId: a.decision.id,
    });
    const linksB = await executionDecisionLinks("http://localhost:3000", {
      userId: user.id,
      decisionId: b.decision.id,
    });
    const { GET, POST } = await import("@/app/api/decisions/link/route");
    const token = (url: string) => new URL(url).searchParams.get("token")!;

    // GET only confirms, with approval wording.
    const page = await GET(new Request(linksA.approve, { headers: { cookie } }));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Approve this draft as Sifty wrote it?");
    expect((await repos.executions.get(user.id, a.execution.id))?.status).toBe("drafted");

    const post = (t: string) => {
      const form = new FormData();
      form.set("token", t);
      return POST(
        new Request("http://localhost:3000/api/decisions/link", { method: "POST", body: form }),
      );
    };
    const approved = await post(token(linksA.approve));
    expect(approved.status).toBe(303);
    // A draft acceptance finishes the execution, so the inbox says "done", not "working".
    expect(new URL(approved.headers.get("location")!).searchParams.get("link")).toBe("done");
    expect((await repos.executions.get(user.id, a.execution.id))?.status).toBe("done");

    const rejected = await post(token(linksB.reject));
    expect(new URL(rejected.headers.get("location")!).searchParams.get("link")).toBe("rejected");
    expect(await repos.executions.get(user.id, b.execution.id)).toMatchObject({
      status: "cancelled",
      cancelReason: "rejected",
    });
    // A second tap on either is "used".
    const again = await post(token(linksA.approve));
    expect(new URL(again.headers.get("location")!).searchParams.get("link")).toBe("used");
  });
});
