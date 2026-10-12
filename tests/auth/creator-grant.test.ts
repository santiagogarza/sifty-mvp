import { getAuth } from "@/lib/auth/auth";
import { getSession, isCreatorEmail } from "@/lib/auth/session";
import { createMemoryRepos, setReposForTesting } from "@/lib/db/repos";
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

async function state(userId: string) {
  const repos = getTestRepos();
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
    }));
    expect((await openLink(firstUrl(lastEmail().text))).status).toBe(302);
    const ent = await repos.entitlements.get(res.user.id);
    expect(ent?.tier).toBe("creator");
    expect(ent?.stripeCustomerId).toBe("cus_creator");
  });

  it("the Google provider refuses a session for an unverified provider email", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    // A fresh repos instance yields a fresh auth instance that reads the env.
    setReposForTesting(createMemoryRepos());
    const google = (
      getAuth().options.socialProviders as Record<string, { requireEmailVerification?: boolean }>
    ).google;
    expect(google).toBeDefined();
    expect(google?.requireEmailVerification).toBe(true);
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
