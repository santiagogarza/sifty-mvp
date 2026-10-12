import { getAuth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_PASSWORD,
  cookieHeaderFromResponse,
  createUserWithCookie,
  firstUrl,
  markEmailVerified,
  signInCookie,
} from "../helpers/auth";
import { getTestOutbox, getTestRepos } from "../setup";

/**
 * End-to-end auth flows against Better Auth's memory adapter and the
 * console email outbox: sign-up → verification email → verify, password
 * reset, magic link, session revocation, bcrypt import, and the
 * `getSession()` contract routes depend on.
 */

function lastEmail() {
  const outbox = getTestOutbox().outbox;
  const last = outbox[outbox.length - 1];
  if (!last) throw new Error("outbox is empty");
  return last;
}

/** Open an emailed link the way a browser would, optionally with cookies. */
async function openLink(url: string, cookie?: string): Promise<Response> {
  return getAuth().handler(
    new Request(url, { redirect: "manual", headers: cookie ? { cookie } : {} }),
  );
}

function headersFor(cookie: string): Headers {
  return new Headers({ cookie });
}

beforeEach(() => {
  vi.stubEnv("SIFTY_DISABLE_AUTH", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sign-up and email verification", () => {
  it("creates the user, entitlement, and labels, and emails a verification link", async () => {
    const auth = getAuth();
    const repos = getTestRepos();

    const res = await auth.api.signUpEmail({
      body: { email: "new@example.com", password: TEST_PASSWORD, name: "New" },
    });
    expect(res.user.email).toBe("new@example.com");

    // Mirrored into the repos with the same id; trial entitlement; labels.
    const profile = await repos.users.getById(res.user.id);
    expect(profile).toMatchObject({
      email: "new@example.com",
      displayName: "New",
      isCreator: false,
    });
    expect((await repos.entitlements.get(res.user.id))?.tier).toBe("trialing");
    expect((await repos.labels.list(res.user.id)).length).toBeGreaterThanOrEqual(6);

    const mail = lastEmail();
    expect(mail.to).toBe("new@example.com");
    expect(mail.subject).toBe("Confirm your email for Sifty");
    expect(mail.category).toBe("transactional");
    expect(firstUrl(mail.text)).toContain("/api/auth/verify-email?token=");
  });

  it("blocks sign-in until the email is verified, then the emailed link verifies it", async () => {
    const auth = getAuth();
    const signUp = await auth.api.signUpEmail({
      body: { email: "unverified@example.com", password: TEST_PASSWORD, name: "U" },
      asResponse: true,
    });
    const browser = cookieHeaderFromResponse(signUp);

    const blocked = await auth.api.signInEmail({
      body: { email: "unverified@example.com", password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(blocked.status).toBe(403);

    const verifyUrl = firstUrl(lastEmail().text);
    expect((await openLink(verifyUrl, browser)).status).toBe(302);
    const ctx = await auth.$context;
    expect(
      (await ctx.internalAdapter.findUserByEmail("unverified@example.com"))?.user.emailVerified,
    ).toBe(true);

    // Verification sent the welcome email (non-transactional, with unsubscribe).
    const welcome = lastEmail();
    expect(welcome.subject).toBe("Welcome to Sifty");
    expect(welcome.category).toBe("notification");
    expect(welcome.headers?.["List-Unsubscribe"]).toBeTruthy();

    const cookie = await signInCookie("unverified@example.com", TEST_PASSWORD);
    expect(cookie).toContain("sifty.session_token=");
  });

  it("rejects short passwords and answers duplicate sign-ups without revealing the account", async () => {
    const auth = getAuth();
    const weak = await auth.api.signUpEmail({
      body: { email: "weak@example.com", password: "short", name: "W" },
      asResponse: true,
    });
    expect(weak.status).toBe(400);

    await auth.api.signUpEmail({
      body: { email: "dup@example.com", password: TEST_PASSWORD, name: "D" },
    });
    const first = (await getTestRepos().users.getByEmail("dup@example.com"))!;
    const sentBefore = getTestOutbox().outbox.length;
    const dup = await auth.api.signUpEmail({
      body: { email: "dup@example.com", password: TEST_PASSWORD, name: "D2" },
    });
    // Anti-enumeration: a generic success with a synthetic user, no new row,
    // no second verification email to the attacker-controlled flow.
    expect(dup.user.id).not.toBe(first.id);
    expect((await getTestRepos().users.getByEmail("dup@example.com"))!.id).toBe(first.id);
    expect(getTestOutbox().outbox.length).toBe(sentBefore);
  });

  it("gives the creator email the creator tier", async () => {
    const auth = getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: "s.gonzalez.garza@gmail.com", password: TEST_PASSWORD, name: "Santi" },
    });
    const repos = getTestRepos();
    expect((await repos.users.getById(res.user.id))?.isCreator).toBe(true);
    expect((await repos.entitlements.get(res.user.id))?.tier).toBe("creator");
  });

  it("defaults the display name to the email local part", async () => {
    const auth = getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: "noname@example.com", password: TEST_PASSWORD, name: "" },
    });
    expect((await getTestRepos().users.getById(res.user.id))?.displayName).toBe("noname");
  });
});

describe("getSession()", () => {
  it("returns the route-facing Session shape for a signed-in request", async () => {
    const repos = getTestRepos();
    const { user, cookie } = await createUserWithCookie(repos, { email: "routes@example.com" });

    const session = await getSession(
      new Request("http://localhost/api/tasks", { headers: { cookie } }),
    );
    expect(session).not.toBeNull();
    expect(session!.user).toEqual(user);
    expect(session!.sessionId).toBeTruthy();
    expect(session!.subscriptionActive).toBe(false);
    expect(session!.trialStartedAt).toBeTruthy();
  });

  it("returns null without a cookie and for a tampered cookie", async () => {
    expect(await getSession(new Request("http://localhost/api/tasks"))).toBeNull();
    expect(
      await getSession(
        new Request("http://localhost/api/tasks", {
          headers: { cookie: "sifty.session_token=forged.signature" },
        }),
      ),
    ).toBeNull();
  });

  it("SIFTY_DISABLE_AUTH=1 yields the bypass session with sessionId null", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    const session = await getSession(new Request("http://localhost/api/tasks"));
    expect(session?.sessionId).toBeNull();
    expect(session?.user.isCreator).toBe(true);
  });

  it("the keyless bypass setup works without BETTER_AUTH_SECRET", async () => {
    vi.stubEnv("SIFTY_DISABLE_AUTH", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const session = await getSession(new Request("http://localhost/api/tasks"));
    expect(session?.sessionId).toBeNull();
    // A stale cookie from a previous configuration must not break it either.
    const withCookie = await getSession(
      new Request("http://localhost/api/tasks", {
        headers: { cookie: "sifty.session_token=old.sig" },
      }),
    );
    expect(withCookie?.sessionId).toBeNull();
  });

  it("without bypass, a missing BETTER_AUTH_SECRET fails loudly on a cookie-bearing request", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const repos = getTestRepos();
    // New repos instance → new auth instance, so the secret is re-read.
    const { cookie } = await (async () => {
      vi.stubEnv("BETTER_AUTH_SECRET", "test-auth-secret-do-not-use-in-production-please-32");
      const r = await createUserWithCookie(repos, { email: "secret@example.com" });
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      return r;
    })();
    expect(cookie).toContain("sifty.session_token=");
    const { setReposForTesting, createMemoryRepos } = await import("@/lib/db/repos");
    setReposForTesting(createMemoryRepos());
    await expect(
      getSession(new Request("http://localhost/api/tasks", { headers: { cookie } })),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("password reset", () => {
  it("emails a reset link, accepts a new password, and revokes existing sessions", async () => {
    const auth = getAuth();
    const repos = getTestRepos();
    const { cookie } = await createUserWithCookie(repos, { email: "reset@example.com" });

    await auth.api.requestPasswordReset({
      body: { email: "reset@example.com", redirectTo: "/reset-password" },
    });
    const mail = lastEmail();
    expect(mail.subject).toBe("Reset your Sifty password");
    const resetUrl = firstUrl(mail.text);
    expect(resetUrl).toContain("/api/auth/reset-password/");

    // Following the link redirects to /reset-password?token=…
    const follow = await auth.handler(new Request(resetUrl, { redirect: "manual" }));
    expect(follow.status).toBeGreaterThanOrEqual(300);
    const location = follow.headers.get("location")!;
    const token = new URL(location, "http://localhost").searchParams.get("token")!;
    expect(token).toBeTruthy();

    await auth.api.resetPassword({ body: { newPassword: "a-brand-new-password", token } });

    // Old session is gone, old password fails, new password works.
    expect(await getSession(new Request("http://localhost/x", { headers: { cookie } }))).toBeNull();
    const old = await auth.api.signInEmail({
      body: { email: "reset@example.com", password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(old.status).toBe(401);
    expect(await signInCookie("reset@example.com", "a-brand-new-password")).toBeTruthy();
  });

  it("does not reveal whether an email exists", async () => {
    const auth = getAuth();
    const before = getTestOutbox().outbox.length;
    const res = await auth.api.requestPasswordReset({
      body: { email: "nobody@example.com", redirectTo: "/reset-password" },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    expect(getTestOutbox().outbox.length).toBe(before);
  });
});

describe("magic link", () => {
  it("signs an existing user in from the emailed link", async () => {
    const auth = getAuth();
    await createUserWithCookie(getTestRepos(), { email: "magic@example.com" });

    await auth.api.signInMagicLink({
      body: { email: "magic@example.com", callbackURL: "/today" },
      headers: new Headers(),
    });
    const mail = lastEmail();
    expect(mail.subject).toBe("Your sign-in link for Sifty");
    const url = firstUrl(mail.text);

    const res = await auth.handler(new Request(url, { redirect: "manual" }));
    const cookie = cookieHeaderFromResponse(res);
    const session = await getSession(new Request("http://localhost/x", { headers: { cookie } }));
    expect(session?.user.email).toBe("magic@example.com");
  });

  it("strips a password planted before the mailbox owner proved the address", async () => {
    // Pre-account-takeover: someone registers the victim's email with their
    // own password. The owner's first proof of the mailbox (the magic link)
    // must not inherit that credential or any standing session.
    const auth = getAuth();
    await auth.api.signUpEmail({
      body: { email: "victim@example.com", password: "attacker-chosen-pw", name: "Attacker" },
    });

    await auth.api.signInMagicLink({
      body: { email: "victim@example.com", callbackURL: "/today" },
      headers: new Headers(),
    });
    const mail = lastEmail();
    expect(mail.subject).toBe("Your sign-in link for Sifty");
    const res = await auth.handler(new Request(firstUrl(mail.text), { redirect: "manual" }));
    const session = await getSession(
      new Request("http://localhost/x", { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(session?.user.email).toBe("victim@example.com");

    const planted = await auth.api.signInEmail({
      body: { email: "victim@example.com", password: "attacker-chosen-pw" },
      asResponse: true,
    });
    expect(planted.status).toBe(401);
    // The owner can set their own password through the reset flow afterwards.
    const before = getTestOutbox().outbox.length;
    await auth.api.requestPasswordReset({
      body: { email: "victim@example.com", redirectTo: "/reset-password" },
    });
    expect(getTestOutbox().outbox.length).toBe(before + 1);
  });
});

describe("session revocation", () => {
  it("revoke-session kills that session only; revoke-other-sessions keeps the current one", async () => {
    const auth = getAuth();
    const repos = getTestRepos();
    const { cookie: a } = await createUserWithCookie(repos, { email: "revoke@example.com" });
    const b = await signInCookie("revoke@example.com", TEST_PASSWORD);
    const c = await signInCookie("revoke@example.com", TEST_PASSWORD);

    const sessions = await auth.api.listSessions({ headers: headersFor(a) });
    expect(sessions).toHaveLength(3);

    const bToken = sessions.find(
      (s) => a.includes(s.token) === false && c.includes(s.token) === false,
    )!.token;
    await auth.api.revokeSession({ body: { token: bToken }, headers: headersFor(a) });
    expect(await getSession(new Request("http://x", { headers: { cookie: b } }))).toBeNull();
    expect(await getSession(new Request("http://x", { headers: { cookie: a } }))).not.toBeNull();

    await auth.api.revokeOtherSessions({ headers: headersFor(a) });
    expect(await getSession(new Request("http://x", { headers: { cookie: c } }))).toBeNull();
    expect(await getSession(new Request("http://x", { headers: { cookie: a } }))).not.toBeNull();

    await auth.api.signOut({ headers: headersFor(a) });
    expect(await getSession(new Request("http://x", { headers: { cookie: a } }))).toBeNull();
  });
});

describe("verify-email as first mailbox proof", () => {
  async function signUpWithBinding(email: string, password: string) {
    const res = await getAuth().api.signUpEmail({
      body: { email, password, name: "X", callbackURL: "/today" },
      asResponse: true,
    });
    expect(res.status).toBe(200);
    const binding = cookieHeaderFromResponse(res);
    expect(binding).toContain("sifty.signup_binding=");
    const url = firstUrl(lastEmail().text);
    return { binding, url };
  }

  it("keeps the password when the link is opened from the browser that signed up", async () => {
    const auth = getAuth();
    const { binding, url } = await signUpWithBinding("same@example.com", TEST_PASSWORD);
    expect((await openLink(url, binding)).status).toBe(302);
    expect(await signInCookie("same@example.com", TEST_PASSWORD)).toBeTruthy();
    void auth;
  });

  it("strips a planted password when the owner opens the link elsewhere", async () => {
    // Attacker registers the victim's address from their own browser…
    const auth = getAuth();
    const { url } = await signUpWithBinding("owner@example.com", "attacker-chosen-pw");

    // …the owner opens the emailed link on a device with no binding cookie.
    const res = await openLink(url);
    expect(`${res.status} ${res.headers.get("location")}`).toBe("302 /today");
    const owner = await getSession(
      new Request("http://x", { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(owner?.user.email).toBe("owner@example.com");

    const planted = await auth.api.signInEmail({
      body: { email: "owner@example.com", password: "attacker-chosen-pw" },
      asResponse: true,
    });
    expect(planted.status).toBe(401);
  });

  it("a second sign-up in the same browser keeps the first binding", async () => {
    const auth = getAuth();
    const first = await signUpWithBinding("first@example.com", TEST_PASSWORD);
    // "Use a different email": the browser presents its existing cookie.
    const second = await auth.api.signUpEmail({
      body: { email: "second@example.com", password: TEST_PASSWORD, name: "S" },
      headers: new Headers({ cookie: first.binding }),
      asResponse: true,
    });
    const both = cookieHeaderFromResponse(second);
    expect((await openLink(first.url, both)).status).toBe(302);
    expect(await signInCookie("first@example.com", TEST_PASSWORD)).toBeTruthy();
  });

  it("a wrong-password attempt does not bind the browser", async () => {
    const auth = getAuth();
    await signUpWithBinding("guess@example.com", TEST_PASSWORD);
    const wrong = await auth.api.signInEmail({
      body: { email: "guess@example.com", password: "not-the-password" },
      asResponse: true,
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie().join(";")).not.toContain("signup_binding");
  });
});

describe("legacy bcrypt accounts", () => {
  it("asks a migrated user to confirm their email once, then the old bcrypt password works", async () => {
    const auth = getAuth();
    const repos = getTestRepos();
    const ctx = await auth.$context;

    // What migration 0004 leaves behind: the users row (unverified, since the
    // old sign-up never proved the address) plus a credential account
    // carrying the old bcrypt hash.
    const user = await ctx.internalAdapter.createUser(
      { id: "user_legacy1", email: "legacy@example.com", name: "Legacy", emailVerified: false },
      { method: "email" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await bcrypt.hash("old-bcrypt-password", 4),
    });

    // First sign-in after the migration: blocked, and a verification link
    // goes out automatically.
    const sent = getTestOutbox().outbox.length;
    const blocked = await auth.api.signInEmail({
      body: { email: "legacy@example.com", password: "old-bcrypt-password" },
      asResponse: true,
    });
    expect(blocked.status).toBe(403);
    expect(getTestOutbox().outbox.length).toBe(sent + 1);
    // The correct password bound this browser; the 403 carried the cookie.
    const binding = cookieHeaderFromResponse(blocked);
    expect(binding).toContain("sifty.signup_binding=");
    expect((await openLink(firstUrl(lastEmail().text), binding)).status).toBe(302);

    // Verified from the same browser: the pre-migration password survives.
    const cookie = await signInCookie("legacy@example.com", "old-bcrypt-password");
    const session = await getSession(new Request("http://x", { headers: { cookie } }));
    expect(session?.user.id).toBe("user_legacy1");
    expect(await repos.users.getById("user_legacy1")).not.toBeNull();

    const wrong = await auth.api.signInEmail({
      body: { email: "legacy@example.com", password: "nope-nope-nope" },
      asResponse: true,
    });
    expect(wrong.status).toBe(401);
  });

  it("a migrated user's first proof via magic link strips the unproven legacy password", async () => {
    const auth = getAuth();
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.createUser(
      { id: "user_legacy2", email: "legacy2@example.com", name: "Legacy", emailVerified: false },
      { method: "email" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await bcrypt.hash("old-bcrypt-password", 4),
    });

    await auth.api.signInMagicLink({
      body: { email: "legacy2@example.com", callbackURL: "/today" },
      headers: new Headers(),
    });
    const res = await auth.handler(new Request(firstUrl(lastEmail().text), { redirect: "manual" }));
    const session = await getSession(
      new Request("http://x", { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(session?.user.id).toBe("user_legacy2");

    const old = await auth.api.signInEmail({
      body: { email: "legacy2@example.com", password: "old-bcrypt-password" },
      asResponse: true,
    });
    expect(old.status).toBe(401);
  });
});
