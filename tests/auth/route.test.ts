import { describe, expect, it } from "vitest";
import {
  TEST_PASSWORD,
  cookieHeaderFromResponse,
  firstUrl,
  markEmailVerified,
} from "../helpers/auth";
import { getTestOutbox, getTestRepos } from "../setup";

/**
 * The `/api/auth/[...all]` route handler as Next mounts it: sign up, verify,
 * sign in, read the session, and sign out through real `Request`s, and a
 * magic link for an address that has never signed up creates a verified
 * account with the same entitlement/labels as a password sign-up.
 */

const ORIGIN = "http://localhost:3000";

async function importRoute() {
  return import("@/app/api/auth/[...all]/route");
}

function post(path: string, body: unknown, cookie?: string): Request {
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

describe("/api/auth/[...all] route", () => {
  it("signs up, verifies, signs in, reads the session, and signs out over HTTP", async () => {
    const { GET, POST } = await importRoute();

    const signUp = await POST(
      post("/api/auth/sign-up/email", {
        email: "route@example.com",
        password: TEST_PASSWORD,
        name: "Route",
        callbackURL: "/today",
      }),
    );
    expect(signUp.status).toBe(200);
    const { user } = (await signUp.json()) as { user: { id: string } };

    const blocked = await POST(
      post("/api/auth/sign-in/email", { email: "route@example.com", password: TEST_PASSWORD }),
    );
    expect(blocked.status).toBe(403);

    const verifyUrl = firstUrl(getTestOutbox().outbox.at(-1)!.text);
    const verified = await GET(new Request(verifyUrl, { redirect: "manual" }));
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe("/today");
    const cookie = cookieHeaderFromResponse(verified);

    const session = await GET(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(session.status).toBe(200);
    expect(((await session.json()) as { user: { id: string } }).user.id).toBe(user.id);

    const signOut = await POST(post("/api/auth/sign-out", {}, cookie));
    expect(signOut.status).toBe(200);
    const after = await GET(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }));
    expect(await after.json()).toBeNull();
  });

  it("rejects cross-origin cookie-bearing POSTs and off-origin callback URLs", async () => {
    const { POST } = await importRoute();
    const csrf = await POST(
      new Request(`${ORIGIN}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: "sifty.session_token=whatever.sig",
        },
        body: "{}",
      }),
    );
    expect(csrf.status).toBe(403);

    const openRedirect = await POST(
      post("/api/auth/sign-in/magic-link", {
        email: "x@example.com",
        callbackURL: "https://evil.example/steal",
      }),
    );
    expect(openRedirect.status).toBe(403);
  });

  it("a magic link for an unknown address creates a verified, entitled account", async () => {
    const { GET, POST } = await importRoute();
    const repos = getTestRepos();

    const req = await POST(
      post("/api/auth/sign-in/magic-link", { email: "fresh@example.com", callbackURL: "/today" }),
    );
    expect(req.status).toBe(200);
    const url = firstUrl(getTestOutbox().outbox.at(-1)!.text);
    const res = await GET(new Request(url, { redirect: "manual" }));
    expect(res.status).toBe(302);
    const cookie = cookieHeaderFromResponse(res);

    const session = await GET(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie } }),
    );
    const body = (await session.json()) as { user: { id: string; emailVerified: boolean } };
    expect(body.user.emailVerified).toBe(true);
    expect((await repos.entitlements.get(body.user.id))?.tier).toBe("trialing");
    expect((await repos.labels.list(body.user.id)).length).toBeGreaterThanOrEqual(6);
    await markEmailVerified(body.user.id);
  });
});
