import type { Repos } from "@/lib/db/repos/types";
import { starterTasks } from "@/lib/onboarding/starter-tasks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

/** Every new account starts with the sifted example tasks. */
const STARTER_TASK_COUNT = starterTasks().length;

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
    // A new account also carries the three starter examples.
    const taskIds = data.tasks.map((t: { id: string }) => t.id);
    expect(taskIds).toContain(mine.task.id);
    expect(taskIds).toHaveLength(STARTER_TASK_COUNT + 1);
    expect(data.tasks.find((t: { id: string }) => t.id === mine.task.id).labelIds).toEqual([
      mine.label.id,
    ]);
    expect(data.labels).toContainEqual(mine.label);
    expect(data.labels.map((l: { id: string }) => l.id)).not.toContain("label_b");
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
      "stage",
      "status",
      "taskId",
      "transport",
    ]);
    expect(data.taskEvents).toEqual([]);
    expect(data.truncated).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("Task b");
    expect(JSON.stringify(data)).not.toContain("b-export@example.com");
  });

  it("requires a session", async () => {
    expect((await exportFor(null)).status).toBe(401);
  });

  it("is rate limited per user", async () => {
    vi.stubEnv("RATELIMIT_ACCOUNT_EXPORT_PER_MIN", "2");
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "burst@example.com" });
    expect((await exportFor(a.cookie)).status).toBe(200);
    expect((await exportFor(a.cookie)).status).toBe(200);
    const limited = await exportFor(a.cookie);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("caps the append-only histories and says so", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "heavy@example.com" });
    const { exportAccount, EXPORT_LIMITS } = await import("@/lib/auth/account");
    const original = repos.aiRuns.list;
    repos.aiRuns.list = async (userId, limit) => {
      expect(limit).toBe(EXPORT_LIMITS.aiRuns);
      return Array.from({ length: limit ?? 0 }, (_, i) => ({
        id: `run_${i}`,
        taskId: null,
        stage: null,
        model: "m",
        transport: "gateway",
        status: "succeeded" as const,
        durationMs: 1,
        inputTokens: null,
        outputTokens: null,
        costCents: null,
        offline: false,
        error: null,
        createdAt: new Date().toISOString(),
      }));
    };
    const data = await exportAccount(repos, a.user.id);
    repos.aiRuns.list = original;
    expect(data?.aiRuns).toHaveLength(EXPORT_LIMITS.aiRuns);
    expect(data?.truncated).toEqual(["aiRuns"]);
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
    expect(await repos.tasks.list(a.user.id)).toHaveLength(STARTER_TASK_COUNT + 1);
  });

  it("cascades through everything the user owns and leaves other tenants intact", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "gone@example.com" });
    const b = await createUserWithCookie(repos, { email: "stays@example.com" });
    await seedWorkspace(repos, a.user.id, "gone");
    await repos.users.setStripeCustomerId(a.user.id, "cus_gone");
    const theirs = await seedWorkspace(repos, b.user.id, "stays");

    const res = await deleteFor(a.cookie, { confirmEmail: "GONE@example.com" });
    expect(res.status).toBe(200);
    // No Stripe keys in tests, so the linked customer is a logged no-op.
    expect(await res.json()).toEqual({ ok: true, stripeCustomer: "skipped" });
    expect(res.headers.get("set-cookie")).toMatch(/sifty\.session_token=;.*Max-Age=0/);

    expect(await repos.users.getById(a.user.id)).toBeNull();
    expect(await repos.users.getByEmail("gone@example.com")).toBeNull();
    expect(await repos.entitlements.get(a.user.id)).toBeNull();
    expect(await repos.tasks.list(a.user.id)).toEqual([]);
    expect(await repos.labels.list(a.user.id)).toEqual([]);
    expect(await repos.memories.list(a.user.id)).toEqual([]);
    expect(await repos.aiRuns.list(a.user.id)).toEqual([]);
    expect(await repos.inviteCodes.listRedemptionsForUser(a.user.id)).toEqual([]);
    expect(await repos.users.findByStripeCustomerId("cus_gone")).toBeNull();
    // The session row is gone too, so the old cookie no longer authenticates.
    expect((await exportFor(a.cookie)).status).toBe(401);

    expect(await repos.users.getById(b.user.id)).not.toBeNull();
    expect((await repos.tasks.list(b.user.id)).map((t) => t.id)).toContain(theirs.task.id);
    expect(await repos.tasks.list(b.user.id)).toHaveLength(STARTER_TASK_COUNT + 1);
    expect(await repos.labels.list(b.user.id)).toContainEqual(theirs.label);
    expect(await repos.memories.list(b.user.id)).toHaveLength(1);
    expect(await repos.aiRuns.list(b.user.id)).toHaveLength(1);
    expect((await exportFor(b.cookie)).status).toBe(200);
  });

  it("reports success when the row is gone even if identity cleanup fails", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "cleanup-fail@example.com" });
    const { getAuth } = await import("@/lib/auth/auth");
    const ctx = await getAuth().$context;
    const original = ctx.internalAdapter.deleteUserSessions;
    ctx.internalAdapter.deleteUserSessions = async () => {
      throw new Error("adapter down");
    };

    const res = await deleteFor(a.cookie, { confirmEmail: "cleanup-fail@example.com" });
    ctx.internalAdapter.deleteUserSessions = original;
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await repos.users.getById(a.user.id)).toBeNull();
  });

  it("purges outstanding reset and magic-link tokens with the identity", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "tokens@example.com" });
    const { getAuth } = await import("@/lib/auth/auth");
    const auth = getAuth();
    await auth.api.requestPasswordReset({
      body: { email: "tokens@example.com", redirectTo: "/reset" },
    });
    // As typed, with different case — Better Auth stores it verbatim.
    await auth.api.signInMagicLink({
      body: { email: "Tokens@Example.com" },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    // Another tenant's pending magic link must survive, even though
    // "tokens_example.com" would LIKE-match "tokens@example.com".
    const bystander = await createUserWithCookie(repos, {
      email: "tokens_example.com@example.org",
    });
    await auth.api.signInMagicLink({
      body: { email: bystander.user.email },
      headers: new Headers({ origin: "http://localhost:3000" }),
    });
    const ctx = await auth.$context;
    const before = await ctx.adapter.findMany({ model: "verification" });
    expect(before.length).toBeGreaterThanOrEqual(2); // reset token + magic link

    const res = await deleteFor(a.cookie, { confirmEmail: "tokens@example.com" });
    expect(res.status).toBe(200);
    const after = await ctx.adapter.findMany<{ value: string }>({ model: "verification" });
    expect(after.filter((v) => v.value === a.user.id)).toHaveLength(0);
    expect(after.filter((v) => v.value.toLowerCase().includes("tokens@example.com"))).toHaveLength(
      0,
    );
    expect(after.filter((v) => v.value.includes(bystander.user.email))).toHaveLength(1);
  });

  it("refuses a pre-deletion email-verification link against the next account with that address", async () => {
    const repos = getTestRepos();
    const { getAuth } = await import("@/lib/auth/auth");
    const { getTestOutbox } = await import("../setup");
    const { firstUrl, markEmailVerified, signInCookie, TEST_PASSWORD } = await import(
      "../helpers/auth"
    );
    const auth = getAuth();
    const email = "reused@example.com";
    const lastMail = () => {
      const outbox = getTestOutbox().outbox;
      return outbox[outbox.length - 1]!;
    };

    // First owner signs up; the verification JWT is a stateless bearer.
    const first = await auth.api.signUpEmail({
      body: { email, password: TEST_PASSWORD, name: "First" },
    });
    const staleLink = firstUrl(lastMail().text);
    await markEmailVerified(first.user.id);
    const cookie = await signInCookie(email, TEST_PASSWORD);
    expect((await deleteFor(cookie, { confirmEmail: email })).status).toBe(200);
    expect(await repos.users.getById(first.user.id)).toBeNull();

    // A successor registers the freed address a little later.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10_000);
    try {
      const second = await auth.api.signUpEmail({
        body: { email, password: "another-passw0rd", name: "Second" },
      });
      const freshLink = firstUrl(lastMail().text);
      const ctx = await auth.$context;

      const stale = await auth.handler(new Request(staleLink, { redirect: "manual" }));
      expect(stale.status).toBeGreaterThanOrEqual(400);
      expect((await ctx.internalAdapter.findUserByEmail(email))?.user.emailVerified).toBe(false);
      // The successor's password survived the refused attempt.
      const accounts = await ctx.internalAdapter.findAccounts(second.user.id);
      expect(accounts.some((a) => a.providerId === "credential")).toBe(true);

      // Their own link still works.
      const fresh = await auth.handler(new Request(freshLink, { redirect: "manual" }));
      expect(fresh.status).toBe(302);
      expect((await ctx.internalAdapter.findUserByEmail(email))?.user.emailVerified).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    expect(await repos.tasks.list(a.user.id)).toHaveLength(STARTER_TASK_COUNT + 1);
  });

  it("says so when the database fails after billing was already cancelled", async () => {
    stripeMock.configured = true;
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "halfway@example.com" });
    const ent = await repos.entitlements.get(a.user.id);
    await repos.entitlements.upsert(a.user.id, { ...ent!, stripeCustomerId: "cus_halfway" });
    const original = repos.users.delete;
    repos.users.delete = async () => {
      throw new Error("connection reset");
    };

    const res = await deleteFor(a.cookie, { confirmEmail: "halfway@example.com" });
    repos.users.delete = original;
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Billing was cancelled/);
    expect(stripeMock.del).toHaveBeenCalledWith("cus_halfway");
    expect(await repos.users.getById(a.user.id)).not.toBeNull();
  });

  it("does not claim billing was cancelled when there was no Stripe customer", async () => {
    const repos = getTestRepos();
    const a = await createUserWithCookie(repos, { email: "plain-fail@example.com" });
    const original = repos.users.delete;
    repos.users.delete = async () => {
      throw new Error("connection reset");
    };

    const res = await deleteFor(a.cookie, { confirmEmail: "plain-fail@example.com" });
    repos.users.delete = original;
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/Nothing was changed/);
    expect(stripeMock.del).not.toHaveBeenCalled();
    expect(await repos.users.getById(a.user.id)).not.toBeNull();
  });

  it("refuses to delete the creator account, whose email would be re-claimable at sign-up", async () => {
    const repos = getTestRepos();
    const creator = await createUserWithCookie(repos, { email: "s.gonzalez.garza@gmail.com" });
    await seedWorkspace(repos, creator.user.id, "creator");

    const res = await deleteFor(creator.cookie, { confirmEmail: "s.gonzalez.garza@gmail.com" });
    expect(res.status).toBe(403);
    expect(await repos.users.getById(creator.user.id)).not.toBeNull();
    expect(await repos.tasks.list(creator.user.id)).toHaveLength(STARTER_TASK_COUNT + 1);
    expect((await exportFor(creator.cookie)).status).toBe(200);
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
