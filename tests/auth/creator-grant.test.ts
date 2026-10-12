import { getAuth } from "@/lib/auth/auth";
import { getSession, isCreatorEmail } from "@/lib/auth/session";
import { createMemoryRepos, setReposForTesting } from "@/lib/db/repos";
import type { Repos } from "@/lib/db/repos/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_PASSWORD, cookieHeaderFromResponse, firstUrl, signInCookie } from "../helpers/auth";
import { getTestOutbox, getTestRepos } from "../setup";

/**
 * The creator tier is the only privilege derived from an email address, so
 * it must never be granted on the address alone. These tests pin the rule
 * from the entitlement audit: `isCreator` and the `creator` entitlement are
 * set only once Better Auth has recorded `emailVerified`, whatever path
 * proved the mailbox, and no client-supplied field can set them.
 */

const CREATOR = "s.gonzalez.garza@gmail.com";
const ORIGIN = "http://localhost:3000";

function lastEmail() {
  const outbox = getTestOutbox().outbox;
  const last = outbox[outbox.length - 1];
  if (!last) throw new Error("outbox is empty");
  return last;
}

async function openLink(url: string, cookie?: string): Promise<Response> {
  return getAuth().handler(
    new Request(url, { redirect: "manual", headers: cookie ? { cookie } : {} }),
  );
}

async function state(userId: string, repos: Repos = getTestRepos()) {
  const ctx = await getAuth().$context;
  const authUser = (await ctx.internalAdapter.findUserById(userId)) as {
    isCreator?: boolean;
    emailVerified: boolean;
  } | null;
  return {
    repoCreator: (await repos.users.getById(userId))?.isCreator,
    tier: (await repos.entitlements.get(userId))?.tier,
    authCreator: authUser?.isCreator === true,
    emailVerified: authUser?.emailVerified ?? null,
  };
}

function postJson(path: string, body: unknown, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SIFTY_DISABLE_AUTH", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("creator grant requires a verified address", () => {
  it("an unverified password sign-up with the creator email is an ordinary trial account", async () => {
    const auth = getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: CREATOR, password: TEST_PASSWORD, name: "Whoever" },
    });
    expect(await state(res.user.id)).toEqual({
      repoCreator: false,
      tier: "trialing",
      authCreator: false,
      emailVerified: false,
    });
    // And no session can be opened for it with the password.
    const blocked = await auth.api.signInEmail({
      body: { email: CREATOR, password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(blocked.status).toBe(403);
  });

  it("the emailed verification link promotes the account (cross-device: planted password is dropped)", async () => {
    const auth = getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: CREATOR, password: "attacker-chosen-pw", name: "Attacker" },
    });
    // The owner opens the link on a device without the sign-up binding.
    const verified = await openLink(firstUrl(lastEmail().text));
    expect(verified.status).toBe(302);
    expect(await state(res.user.id)).toEqual({
      repoCreator: true,
      tier: "creator",
      authCreator: true,
      emailVerified: true,
    });
    // The owner is signed in as creator; the attacker's password is gone.
    const session = await getSession(
      new Request(`${ORIGIN}/api/tasks`, {
        headers: { cookie: cookieHeaderFromResponse(verified) },
      }),
    );
    expect(session?.user.isCreator).toBe(true);
    const planted = await auth.api.signInEmail({
      body: { email: CREATOR, password: "attacker-chosen-pw" },
      asResponse: true,
    });
    expect(planted.status).toBe(401);
  });

  it("same-browser verification promotes and keeps the password", async () => {
    const auth = getAuth();
    const signUp = await auth.api.signUpEmail({
      body: { email: CREATOR, password: TEST_PASSWORD, name: "Santi", callbackURL: "/today" },
      asResponse: true,
    });
    const binding = cookieHeaderFromResponse(signUp);
    expect((await openLink(firstUrl(lastEmail().text), binding)).status).toBe(302);
    const cookie = await signInCookie(CREATOR, TEST_PASSWORD);
    const session = await getSession(new Request(`${ORIGIN}/x`, { headers: { cookie } }));
    expect(session?.user.isCreator).toBe(true);
    expect(session?.entitlement?.tier).toBe("creator");
  });

  it("a magic link for a never-registered creator address creates a verified creator account", async () => {
    const auth = getAuth();
    await auth.api.signInMagicLink({
      body: { email: CREATOR, callbackURL: "/today" },
      headers: new Headers(),
    });
    const res = await auth.handler(new Request(firstUrl(lastEmail().text), { redirect: "manual" }));
    const session = await getSession(
      new Request(`${ORIGIN}/x`, { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(session?.user.email).toBe(CREATOR);
    expect(await state(session!.user.id)).toEqual({
      repoCreator: true,
      tier: "creator",
      authCreator: true,
      emailVerified: true,
    });
  });

  it("the owner's magic link on an attacker-registered account promotes it and strips the password", async () => {
    const auth = getAuth();
    const planted = await auth.api.signUpEmail({
      body: { email: CREATOR, password: "attacker-chosen-pw", name: "Attacker" },
    });
    expect((await state(planted.user.id)).tier).toBe("trialing");

    await auth.api.signInMagicLink({
      body: { email: CREATOR, callbackURL: "/today" },
      headers: new Headers(),
    });
    const res = await auth.handler(new Request(firstUrl(lastEmail().text), { redirect: "manual" }));
    const session = await getSession(
      new Request(`${ORIGIN}/x`, { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(session?.user.id).toBe(planted.user.id);
    expect(session?.user.isCreator).toBe(true);
    expect((await state(planted.user.id)).tier).toBe("creator");
    const old = await auth.api.signInEmail({
      body: { email: CREATOR, password: "attacker-chosen-pw" },
      asResponse: true,
    });
    expect(old.status).toBe(401);
  });

  it("an OAuth-style creation with an unverified provider claim is not creator until verified", async () => {
    // What `handleOAuthUserInfo` does for a provider that reports
    // `email_verified: false`: create the user with that flag, then flip it
    // when a verified sign-in links the same address.
    const ctx = await getAuth().$context;
    const user = await ctx.internalAdapter.createUser(
      { email: CREATOR, name: "Via Google", emailVerified: false },
      { method: "oauth" },
    );
    expect(await state(user.id)).toEqual({
      repoCreator: false,
      tier: "trialing",
      authCreator: false,
      emailVerified: false,
    });

    await ctx.internalAdapter.updateUser(user.id, { emailVerified: true });
    expect(await state(user.id)).toEqual({
      repoCreator: true,
      tier: "creator",
      authCreator: true,
      emailVerified: true,
    });
  });

  it("an OAuth-style creation with a verified claim is creator at once", async () => {
    const ctx = await getAuth().$context;
    const user = await ctx.internalAdapter.createUser(
      { email: CREATOR, name: "Via Google", emailVerified: true },
      { method: "oauth" },
    );
    expect((await state(user.id)).tier).toBe("creator");
  });

  it("promotion keeps Stripe facts already on the row", async () => {
    const repos = getTestRepos();
    const auth = getAuth();
    const res = await auth.api.signUpEmail({
      body: { email: CREATOR, password: TEST_PASSWORD, name: "Santi" },
    });
    await repos.entitlements.update(res.user.id, (current) => ({
      ...current!,
      stripeCustomerId: "cus_creator",
      stripeSubscriptionId: "sub_creator",
      stripeStatus: "active",
      subscriptionActive: true,
      currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    }));
    expect((await openLink(firstUrl(lastEmail().text))).status).toBe(302);
    const ent = await repos.entitlements.get(res.user.id);
    expect(ent).toMatchObject({
      tier: "creator",
      stripeCustomerId: "cus_creator",
      stripeSubscriptionId: "sub_creator",
      stripeStatus: "active",
      subscriptionActive: true,
      currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    });
  });

  it("the Google provider is configured to refuse a session for an unverified provider email", async () => {
    const { auth } = googleEnabledAuth();
    const google = (
      auth.options.socialProviders as Record<string, { requireEmailVerification?: boolean }>
    ).google;
    expect(google).toBeDefined();
    expect(google?.requireEmailVerification).toBe(true);
  });
});

/**
 * A Better Auth instance with the Google provider on. The env is read when
 * the instance is built, and instances are keyed by repos, so a fresh repos
 * handle yields a fresh instance; tests that use it read state from `repos`.
 */
function googleEnabledAuth() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  const repos = createMemoryRepos();
  setReposForTesting(repos);
  return { auth: getAuth(), repos };
}

/** An id token as Google would mint it; the callback path decodes it without verifying. */
function googleIdToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", kid: "k1" })}.${b64({
    iss: "https://accounts.google.com",
    aud: "client-id",
    sub: "google-sub-1",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.sig`;
}

/**
 * Run the real `/sign-in/social` → `/callback/google` round trip with the
 * token endpoint stubbed to return `idToken`. Returns the callback response.
 */
async function googleCallback(auth: ReturnType<typeof getAuth>, idToken: string) {
  const start = await auth.api.signInSocial({
    body: { provider: "google", callbackURL: "/today", disableRedirect: true },
    headers: new Headers({ origin: ORIGIN }),
    asResponse: true,
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  const stateCookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");

  const realFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const target =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (target.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "ya29.test",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
          id_token: idToken,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return realFetch(input, init);
  });
  try {
    return await auth.handler(
      new Request(`${ORIGIN}/api/auth/callback/google?code=auth-code&state=${state}`, {
        redirect: "manual",
        headers: stateCookie ? { cookie: stateCookie } : {},
      }),
    );
  } finally {
    fetchSpy.mockRestore();
  }
}

describe("Google sign-in with the creator address (real callback, stubbed token endpoint)", () => {
  it("an unverified provider claim creates an unverified trial account and no session", async () => {
    const { auth, repos } = googleEnabledAuth();
    const res = await googleCallback(
      auth,
      googleIdToken({ email: CREATOR, email_verified: false, name: "Claimed" }),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=email_not_verified");
    expect(res.headers.getSetCookie().join(";")).not.toContain("sifty.session_token=");

    const user = await repos.users.getByEmail(CREATOR);
    expect(user).not.toBeNull();
    expect(user?.isCreator).toBe(false);
    expect((await repos.entitlements.get(user!.id))?.tier).toBe("trialing");
    const ctx = await auth.$context;
    expect((await ctx.internalAdapter.findUserByEmail(CREATOR))?.user.emailVerified).toBe(false);
    // The usual verification email went out to the real mailbox instead.
    expect(lastEmail().subject).toBe("Confirm your email for Sifty");

    // Google later asserts the same account verified. Better Auth 1.7.7
    // records `emailVerified` (which promotes the account through the
    // update hook) but still gates this response on the pre-update user
    // object, so this attempt is refused and the next one signs in.
    const again = await googleCallback(
      auth,
      googleIdToken({ email: CREATOR, email_verified: true, name: "Santi" }),
    );
    expect(again.headers.get("location")).toContain("error=email_not_verified");
    expect(await state(user!.id, repos)).toEqual({
      repoCreator: true,
      tier: "creator",
      authCreator: true,
      emailVerified: true,
    });

    const third = await googleCallback(
      auth,
      googleIdToken({ email: CREATOR, email_verified: true, name: "Santi" }),
    );
    expect(`${third.status} ${third.headers.get("location")}`).toBe("302 /today");
    const session = await getSession(
      new Request(`${ORIGIN}/x`, { headers: { cookie: cookieHeaderFromResponse(third) } }),
    );
    expect(session?.user.id).toBe(user!.id);
    expect(session?.user.isCreator).toBe(true);
    expect(session?.entitlement?.tier).toBe("creator");
  });

  it("a verified provider claim signs in as creator at once", async () => {
    const { auth, repos } = googleEnabledAuth();
    const res = await googleCallback(
      auth,
      googleIdToken({ email: CREATOR, email_verified: true, name: "Santi" }),
    );
    expect(`${res.status} ${res.headers.get("location")}`).toBe("302 /today");
    const session = await getSession(
      new Request(`${ORIGIN}/x`, { headers: { cookie: cookieHeaderFromResponse(res) } }),
    );
    expect(session?.user.isCreator).toBe(true);
    expect((await repos.entitlements.get(session!.user.id))?.tier).toBe("creator");
  });

  it("a verified claim for an ordinary address is a trial account", async () => {
    const { auth, repos } = googleEnabledAuth();
    const res = await googleCallback(
      auth,
      googleIdToken({ email: "someone@example.com", email_verified: true, name: "Someone" }),
    );
    expect(res.status).toBe(302);
    const user = await repos.users.getByEmail("someone@example.com");
    expect(user?.isCreator).toBe(false);
    expect((await repos.entitlements.get(user!.id))?.tier).toBe("trialing");
  });
});

describe("getSession() fallback profile", () => {
  it("takes the creator flag from Better Auth, not from the email", async () => {
    const repos = getTestRepos();
    const auth = getAuth();
    const ctx = await auth.$context;
    const res = await auth.api.signUpEmail({
      body: { email: CREATOR, password: TEST_PASSWORD, name: "Santi" },
    });
    // Mark verified behind the hooks' back so the promotion never ran, then
    // sign in and drop the repos mirror so the fallback path is exercised.
    await ctx.adapter.update({
      model: "user",
      where: [{ field: "id", value: res.user.id }],
      update: { emailVerified: true },
    });
    const cookie = await signInCookie(CREATOR, TEST_PASSWORD);
    expect(await repos.users.delete(res.user.id)).toBe(true);

    const session = await getSession(new Request(`${ORIGIN}/x`, { headers: { cookie } }));
    expect(session?.user.email).toBe(CREATOR);
    expect(session?.user.isCreator).toBe(false);

    // And the flag is honoured when Better Auth does carry it: the fallback
    // reads the stored flag, it does not simply return false.
    await ctx.adapter.update({
      model: "user",
      where: [{ field: "id", value: res.user.id }],
      update: { isCreator: true },
    });
    const promoted = await getSession(new Request(`${ORIGIN}/x`, { headers: { cookie } }));
    expect(promoted?.user.isCreator).toBe(true);
  });
});

describe("client input cannot set the creator flag", () => {
  it("sign-up ignores an `isCreator` field in the body", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const res = await POST(
      postJson("/api/auth/sign-up/email", {
        email: "wannabe@example.com",
        password: TEST_PASSWORD,
        name: "Wannabe",
        isCreator: true,
      }),
    );
    expect(res.status).toBe(200);
    const { user } = (await res.json()) as { user: { id: string } };
    expect(await state(user.id)).toMatchObject({ repoCreator: false, tier: "trialing" });
  });

  it("update-user rejects `isCreator`, and change-email is disabled", async () => {
    const repos = getTestRepos();
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const auth = getAuth();
    const signedUp = await auth.api.signUpEmail({
      body: { email: "member@example.com", password: TEST_PASSWORD, name: "Member" },
    });
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateUser(signedUp.user.id, { emailVerified: true });
    const cookie = await signInCookie("member@example.com", TEST_PASSWORD);

    const update = await POST(
      postJson("/api/auth/update-user", { name: "Still Member", isCreator: true }, cookie),
    );
    // `additionalFields.isCreator` has `input: false`: the request is refused
    // as a whole rather than the field being silently dropped.
    expect(update.status).toBe(400);
    expect(((await update.json()) as { code: string }).code).toBe("FIELD_NOT_ALLOWED");
    expect(await state(signedUp.user.id)).toMatchObject({
      repoCreator: false,
      authCreator: false,
      tier: "trialing",
    });

    const change = await POST(postJson("/api/auth/change-email", { newEmail: CREATOR }, cookie));
    expect(change.status).toBe(400);
    expect((await repos.users.getById(signedUp.user.id))?.email).toBe("member@example.com");
    expect(
      ((await ctx.internalAdapter.findUserById(signedUp.user.id)) as { email: string }).email,
    ).toBe("member@example.com");
  });
});

describe("creator email matching", () => {
  it("is exact after lowercasing: no trimming, aliasing, or Unicode folding", () => {
    expect(isCreatorEmail(CREATOR)).toBe(true);
    expect(isCreatorEmail("S.Gonzalez.Garza@Gmail.com")).toBe(true);
    expect(isCreatorEmail(` ${CREATOR}`)).toBe(false);
    expect(isCreatorEmail(`${CREATOR} `)).toBe(false);
    expect(isCreatorEmail("s.gonzalez.garza+x@gmail.com")).toBe(false);
    expect(isCreatorEmail("sgonzalezgarza@gmail.com")).toBe(false);
    expect(isCreatorEmail("s.gonzalez.garza@gmail.com\u200b")).toBe(false);
    expect(isCreatorEmail("ѕ.gonzalez.garza@gmail.com")).toBe(false); // Cyrillic dze
  });

  it("sign-up rejects addresses with surrounding whitespace rather than trimming into a match", async () => {
    const res = await getAuth().api.signUpEmail({
      body: { email: ` ${CREATOR}`, password: TEST_PASSWORD, name: "X" },
      asResponse: true,
    });
    expect(res.status).toBe(400);
    expect(await getTestRepos().users.getByEmail(CREATOR)).toBeNull();
  });
});
