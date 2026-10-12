import {
  DECISION_LINK_TTL_SECONDS,
  createDecisionLinkToken,
  decisionLinkUrl,
  decisionLinks,
  verifyDecisionLinkToken,
} from "@/lib/decisions/links";
import { openClarifyingQuestion } from "@/lib/decisions/service";
import { __resetRateLimits } from "@/lib/ratelimit/limiter";
import { type WorkflowClient, setWorkflowClientForTesting } from "@/lib/workflows/dispatch";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * One-tap links: the token is the credential, so it must be unforgeable,
 * short-lived, and scoped to one decision and one action; the route must
 * refuse a link opened in the wrong account and never act twice.
 */

const client = {
  start: vi.fn<WorkflowClient["start"]>(),
  wait: vi.fn<WorkflowClient["wait"]>(),
  resume: vi.fn<WorkflowClient["resume"]>(),
};

let userId: string;
let cookie: string;
let otherCookie: string;

beforeEach(async () => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty.test");
  __resetRateLimits();
  client.start.mockReset().mockResolvedValue({ runId: "wrun_link" });
  client.resume.mockReset().mockResolvedValue({ ok: true, runId: "wrun_asked" });
  setWorkflowClientForTesting(client);
  const repos = getTestRepos();
  const me = await createUserWithCookie(repos, { email: "linker@example.com" });
  userId = me.user.id;
  cookie = me.cookie;
  otherCookie = (await createUserWithCookie(repos, { email: "stranger@example.com" })).cookie;
});

afterEach(() => {
  setWorkflowClientForTesting(null);
  vi.unstubAllEnvs();
});

async function seedQuestion() {
  const repos = getTestRepos();
  const task = await repos.tasks.create(userId, { sourceText: "Taxes", sourceContext: null });
  await repos.tasks.update(userId, task.id, { siftId: "sift_l", aiStatus: "ready" });
  const decision = await openClarifyingQuestion(repos, userId, {
    id: "dec_link",
    taskId: task.id,
    siftId: "sift_l",
    question: "Which year?",
    options: ["2025", "2026"],
    confidence: 0.4,
  });
  return { repos, task, decision };
}

async function follow(token: string | null, headers: Record<string, string> = {}) {
  const { GET } = await import("@/app/api/decisions/link/route");
  const url = new URL("http://localhost/api/decisions/link");
  if (token !== null) url.searchParams.set("token", token);
  return GET(new Request(url, { headers }));
}

describe("decision link tokens", () => {
  it("round-trip every action and carry the user, decision, and a token id", async () => {
    const now = new Date("2026-10-12T12:00:00Z");
    for (const link of [
      { action: "open" as const },
      { action: "dismiss" as const },
      { action: "answer" as const, option: "2026" },
    ]) {
      const token = await createDecisionLinkToken({ userId: "u1", decisionId: "d1", link, now });
      const verified = await verifyDecisionLinkToken(token, now);
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error("unreachable");
      expect(verified.claims).toMatchObject({ userId: "u1", decisionId: "d1", link });
      expect(verified.claims.jti).toMatch(/^dlk_/);
    }
  });

  it("expire after 24 hours, and reject tampering, garbage, and foreign signatures", async () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const token = await createDecisionLinkToken({
      userId: "u1",
      decisionId: "d1",
      link: { action: "open" },
      now,
    });
    const later = new Date(now.getTime() + (DECISION_LINK_TTL_SECONDS + 60) * 1000);
    expect(await verifyDecisionLinkToken(token, later)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyDecisionLinkToken(`${token}x`, now)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyDecisionLinkToken("not.a.jwt", now)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await verifyDecisionLinkToken("", now)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyDecisionLinkToken(null, now)).toEqual({ ok: false, reason: "malformed" });

    vi.stubEnv("BETTER_AUTH_SECRET", "a-completely-different-secret-of-32-chars!!");
    expect(await verifyDecisionLinkToken(token, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("decisionLinks builds one URL per action for the notifications worker", async () => {
    const links = await decisionLinks("https://sifty.test", {
      userId: "u1",
      decisionId: "d1",
      options: ["2025", "2026"],
    });
    expect(links.open).toMatch(/^https:\/\/sifty\.test\/api\/decisions\/link\?token=/);
    expect(links.answers.map((a) => a.option)).toEqual(["2025", "2026"]);
    const token = new URL(links.answers[1]!.url).searchParams.get("token");
    const verified = await verifyDecisionLinkToken(token);
    expect(verified.ok && verified.claims.link).toEqual({ action: "answer", option: "2026" });
    expect(decisionLinkUrl("https://sifty.test", "t k")).toBe(
      "https://sifty.test/api/decisions/link?token=t%20k",
    );
  });
});

describe("GET /api/decisions/link", () => {
  it("redirects bad tokens into the inbox with a reason", async () => {
    const res = await follow(null);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://sifty.test/decisions?link=malformed");
    const garbage = await follow("abc.def.ghi");
    expect(garbage.headers.get("location")).toBe("https://sifty.test/decisions?link=invalid");
  });

  it("an `open` link deep-links to the decision and leaves it open", async () => {
    const { repos, decision } = await seedQuestion();
    const token = await createDecisionLinkToken({
      userId,
      decisionId: decision.id,
      link: { action: "open" },
    });
    const res = await follow(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://sifty.test/decisions?focus=${decision.id}`);
    expect((await repos.decisions.get(userId, decision.id))?.status).toBe("open");
  });

  it("answers with the tapped option without a session, once", async () => {
    const { repos, task, decision } = await seedQuestion();
    const token = await createDecisionLinkToken({
      userId,
      decisionId: decision.id,
      link: { action: "answer", option: "2026" },
    });
    const res = await follow(token);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://sifty.test/decisions?link=answered");
    const stored = await repos.decisions.get(userId, decision.id);
    expect(stored?.status).toBe("answered");
    expect(stored?.answer).toEqual({ text: null, option: "2026", via: "link" });
    expect(client.resume).toHaveBeenCalledTimes(1);
    expect((await repos.tasks.get(userId, task.id))?.aiStatus).toBe("pending");

    // Second tap on the same link, or on the sibling option: already used.
    expect((await follow(token)).headers.get("location")).toBe(
      "https://sifty.test/decisions?link=used",
    );
    const sibling = await createDecisionLinkToken({
      userId,
      decisionId: decision.id,
      link: { action: "answer", option: "2025" },
    });
    expect((await follow(sibling)).headers.get("location")).toBe(
      "https://sifty.test/decisions?link=used",
    );
    expect(client.resume).toHaveBeenCalledTimes(1);
  });

  it("dismisses via link and marks the task sifted-with-assumptions", async () => {
    const { repos, task, decision } = await seedQuestion();
    const token = await createDecisionLinkToken({
      userId,
      decisionId: decision.id,
      link: { action: "dismiss" },
    });
    const res = await follow(token, { cookie });
    expect(res.headers.get("location")).toBe("https://sifty.test/decisions?link=dismissed");
    expect((await repos.decisions.get(userId, decision.id))?.status).toBe("dismissed");
    expect((await repos.tasks.get(userId, task.id))?.siftedWithAssumptions).toBe(true);
  });

  it("refuses a link opened while signed in as someone else (403) and acts on nothing", async () => {
    const { repos, decision } = await seedQuestion();
    const token = await createDecisionLinkToken({
      userId,
      decisionId: decision.id,
      link: { action: "dismiss" },
    });
    const res = await follow(token, { cookie: otherCookie });
    expect(res.status).toBe(403);
    expect((await repos.decisions.get(userId, decision.id))?.status).toBe("open");
    expect(client.resume).not.toHaveBeenCalled();
  });

  it("a token for a decision that no longer exists lands on `gone`", async () => {
    const token = await createDecisionLinkToken({
      userId,
      decisionId: "dec_missing",
      link: { action: "dismiss" },
    });
    expect((await follow(token)).headers.get("location")).toBe(
      "https://sifty.test/decisions?link=gone",
    );
  });
});
