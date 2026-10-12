import type { Repos } from "@/lib/db/repos/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/**
 * Account export and deletion. Both are tenant-scoped through the repos;
 * these tests pin that a signed-in user can only reach their own rows, and
 * that deletion cascades locally and through the billing seam.
 */

const stripeMock = vi.hoisted(() => ({
  configured: false,
  del: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/billing/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/stripe")>();
  return {
    ...actual,
    getStripe: () => {
      if (!stripeMock.configured) throw new actual.StripeNotConfiguredError("STRIPE_SECRET_KEY");
      return { customers: { del: stripeMock.del } };
    },
  };
});

beforeEach(() => {
  stripeMock.configured = false;
  stripeMock.del.mockReset();
  stripeMock.del.mockResolvedValue({ deleted: true });
});

async function seedWorkspace(repos: Repos, userId: string, tag: string) {
  const label = await repos.labels.ensure(userId, {
    id: `label_${tag}`,
    name: `Label ${tag}`,
    tone: "sand",
  });
  const task = await repos.tasks.create(userId, { sourceText: `Task ${tag}`, sourceContext: null });
  await repos.tasks.update(userId, task.id, { labelIds: [label.id] });
  await repos.memories.create(userId, { text: `Memory ${tag}` });
  await repos.aiRuns.insert({
    userId,
    taskId: task.id,
    promptVersion: "triage.v1",
    model: "anthropic/claude-haiku-4-5",
    transport: "gateway",
    status: "succeeded",
    durationMs: 10,
    inputTokens: 1,
    outputTokens: 1,
    costCents: 0,
    offline: false,
    error: null,
  });
  return { label, task };
}

async function exportFor(cookie: string | null) {
  const { GET } = await import("@/app/api/account/export/route");
  return GET(
    new Request("http://localhost/api/account/export", {
      headers: cookie ? { cookie } : undefined,
    }),
  );
}

async function deleteFor(cookie: string | null, body: unknown) {
  const { DELETE } = await import("@/app/api/account/route");
  return DELETE(
    new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

describe("GET /api/account/export", () => {
  it("returns everything the user owns and nothing of anyone else's", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "a-export@example.com" });
    const b = await createUserWithCookie(repos, { email: "b-export@example.com" });
    const mine = await seedWorkspace(repos, a.user.id, "a");
    await seedWorkspace(repos, b.user.id, "b");

    const res = await exportFor(a.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="sifty-export-/);
    const data = await res.json();

    expect(data.format).toBe("sifty-export");
    expect(data.user.id).toBe(a.user.id);
    expect(data.user).not.toHaveProperty("passwordHash");
    expect(data.entitlement?.tier).toBe("trialing");
    expect(data.tasks.map((t: { id: string }) => t.id)).toEqual([mine.task.id]);
    expect(data.tasks[0].labelIds).toEqual([mine.label.id]);
    expect(data.labels).toEqual([mine.label]);
    expect(data.memories.map((m: { text: string }) => m.text)).toEqual(["Memory a"]);
    expect(data.aiRuns).toHaveLength(1);
    expect(data.aiRuns[0].taskId).toBe(mine.task.id);
    expect(Object.keys(data.aiRuns[0]).sort()).toEqual([
      "costCents",
      "createdAt",
      "durationMs",
      "error",
      "id",
      "inputTokens",
      "model",
      "offline",
      "outputTokens",
      "status",
      "taskId",
      "transport",
    ]);
    expect(data.taskEvents).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("Task b");
    expect(JSON.stringify(data)).not.toContain("b-export@example.com");
  });

  it("requires a session", async () => {
    expect((await exportFor(null)).status).toBe(401);
  });
});

describe("DELETE /api/account", () => {
  it("refuses without a matching email confirmation and changes nothing", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "keep@example.com" });
    await seedWorkspace(repos, a.user.id, "keep");

    expect((await deleteFor(a.cookie, {})).status).toBe(400);
    expect((await deleteFor(a.cookie, { confirmEmail: "someone-else@example.com" })).status).toBe(
      400,
    );
    expect((await deleteFor(null, { confirmEmail: "keep@example.com" })).status).toBe(401);

    expect(await repos.users.getById(a.user.id)).not.toBeNull();
    expect(await repos.tasks.list(a.user.id)).toHaveLength(1);
  });

  it("cascades through everything the user owns and leaves other tenants intact", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "gone@example.com" });
    const b = await createUserWithCookie(repos, { email: "stays@example.com" });
    await seedWorkspace(repos, a.user.id, "gone");
    const theirs = await seedWorkspace(repos, b.user.id, "stays");

    const res = await deleteFor(a.cookie, { confirmEmail: "GONE@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stripeCustomer: "none" });
    expect(res.headers.get("set-cookie")).toMatch(/sifty_session=;.*Max-Age=0/);

    expect(await repos.users.getById(a.user.id)).toBeNull();
    expect(await repos.users.getByEmail("gone@example.com")).toBeNull();
    expect(await repos.entitlements.get(a.user.id)).toBeNull();
    expect(await repos.tasks.list(a.user.id)).toEqual([]);
    expect(await repos.labels.list(a.user.id)).toEqual([]);
    expect(await repos.memories.list(a.user.id)).toEqual([]);
    expect(await repos.aiRuns.list(a.user.id)).toEqual([]);
    // The session row is gone too, so the old cookie no longer authenticates.
    expect((await exportFor(a.cookie)).status).toBe(401);

    expect(await repos.users.getById(b.user.id)).not.toBeNull();
    expect((await repos.tasks.list(b.user.id)).map((t) => t.id)).toEqual([theirs.task.id]);
    expect(await repos.labels.list(b.user.id)).toEqual([theirs.label]);
    expect(await repos.memories.list(b.user.id)).toHaveLength(1);
    expect(await repos.aiRuns.list(b.user.id)).toHaveLength(1);
    expect((await exportFor(b.cookie)).status).toBe(200);
  });

  it("is a no-op for Stripe when keys are not configured", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "nokeys@example.com" });
    const ent = await repos.entitlements.get(a.user.id);
    await repos.entitlements.upsert(a.user.id, { ...ent!, stripeCustomerId: "cus_nokeys" });

    const res = await deleteFor(a.cookie, { confirmEmail: "nokeys@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stripeCustomer: "skipped" });
    expect(stripeMock.del).not.toHaveBeenCalled();
    expect(await repos.users.getById(a.user.id)).toBeNull();
  });

  it("deletes the Stripe customer through the billing seam when one exists", async () => {
    stripeMock.configured = true;
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "paying@example.com" });
    const ent = await repos.entitlements.get(a.user.id);
    await repos.entitlements.upsert(a.user.id, { ...ent!, stripeCustomerId: "cus_paying" });

    const res = await deleteFor(a.cookie, { confirmEmail: "paying@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stripeCustomer: "deleted" });
    expect(stripeMock.del).toHaveBeenCalledWith("cus_paying");
    expect(await repos.users.getById(a.user.id)).toBeNull();
  });

  it("keeps the account when Stripe refuses, so no orphaned billing relationship is left", async () => {
    stripeMock.configured = true;
    stripeMock.del.mockRejectedValue(Object.assign(new Error("boom"), { code: "api_error" }));
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "stuck@example.com" });
    const ent = await repos.entitlements.get(a.user.id);
    await repos.entitlements.upsert(a.user.id, { ...ent!, stripeCustomerId: "cus_stuck" });
    await seedWorkspace(repos, a.user.id, "stuck");

    const res = await deleteFor(a.cookie, { confirmEmail: "stuck@example.com" });
    expect(res.status).toBe(502);
    expect(await repos.users.getById(a.user.id)).not.toBeNull();
    expect(await repos.tasks.list(a.user.id)).toHaveLength(1);
  });

  it("treats a customer Stripe already forgot as deleted", async () => {
    stripeMock.configured = true;
    stripeMock.del.mockRejectedValue(
      Object.assign(new Error("No such customer"), { code: "resource_missing" }),
    );
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "forgotten@example.com" });
    const ent = await repos.entitlements.get(a.user.id);
    await repos.entitlements.upsert(a.user.id, { ...ent!, stripeCustomerId: "cus_forgotten" });

    const res = await deleteFor(a.cookie, { confirmEmail: "forgotten@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stripeCustomer: "deleted" });
  });

  it("is unavailable in auth-bypass mode", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    const res = await deleteFor(null, { confirmEmail: "s.gonzalez.garza@gmail.com" });
    expect(res.status).toBe(400);
  });
});
