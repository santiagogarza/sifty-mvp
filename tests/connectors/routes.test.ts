import { emptySnapshot } from "@/lib/entitlements/entitlements";
import { describe, expect, it, vi } from "vitest";
import { createUserWithCookie } from "../helpers/auth";
import { getTestRepos } from "../setup";

const APP = "http://localhost:3000";

let seq = 0;
async function signedIn() {
  seq += 1;
  const { user, cookie } = await createUserWithCookie(getTestRepos(), {
    email: `conn-${seq}@example.com`,
  });
  const request = (path: string, init: { method?: string } = {}) =>
    new Request(`${APP}${path}`, { method: init.method ?? "GET", headers: { cookie } });
  return { user, request };
}

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

describe("/api/connectors", () => {
  it("401s when signed out and lists providers when signed in", async () => {
    const { GET } = await import("@/app/api/connectors/route");
    expect((await GET(new Request(`${APP}/api/connectors`))).status).toBe(401);

    const { request } = await signedIn();
    const res = await GET(request("/api/connectors"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
    expect(body.proRequiredMessage).toBeNull();
    expect(body.providers.map((p: { provider: string }) => p.provider)).toContain("mock");
    const google = body.providers.find((p: { provider: string }) => p.provider === "google");
    expect(google.availability).toBe("not_configured");
    expect(google.scopes[0]).toEqual(
      expect.objectContaining({ label: expect.any(String), kind: "read" }),
    );
    expect(JSON.stringify(body)).not.toMatch(/encryptedSecret|authState/);
  });

  it("runs the mock flow end to end: start → callback → connected → check → disconnect", async () => {
    const start = await import("@/app/api/connectors/[provider]/start/route");
    const callback = await import("@/app/api/connectors/[provider]/callback/route");
    const provider = await import("@/app/api/connectors/[provider]/route");
    const list = await import("@/app/api/connectors/route");
    const { user, request } = await signedIn();

    const started = await start.POST(
      request("/api/connectors/mock/start", { method: "POST" }),
      params("mock"),
    );
    expect(started.status).toBe(200);
    const { url } = (await started.json()) as { url: string };
    expect(url.startsWith(`${APP}/api/connectors/mock/callback?`)).toBe(true);

    const cb = await callback.GET(request(url.replace(APP, "")), params("mock"));
    expect(cb.status).toBe(303);
    expect(cb.headers.get("location")).toBe(`${APP}/settings/connections?connected=mock`);

    const after = await (await list.GET(request("/api/connectors"))).json();
    expect(after.providers.find((p: { provider: string }) => p.provider === "mock")).toMatchObject({
      status: "connected",
      externalAccount: "mock@sifty.local",
    });
    const row = await getTestRepos().connections.get(user.id, "mock");
    expect(row?.encryptedSecret).toMatch(/^v1\./);

    const checked = await provider.POST(
      request("/api/connectors/mock", { method: "POST" }),
      params("mock"),
    );
    expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({ status: "connected", lastError: null });

    const removed = await provider.DELETE(
      request("/api/connectors/mock", { method: "DELETE" }),
      params("mock"),
    );
    expect(await removed.json()).toEqual({ ok: true, removed: true });
    expect(await getTestRepos().connections.get(user.id, "mock")).toBeNull();
    const again = await provider.POST(
      request("/api/connectors/mock", { method: "POST" }),
      params("mock"),
    );
    expect(again.status).toBe(409);
  });

  it("sends a signed-out callback to sign-in and comes back to the same URL", async () => {
    const callback = await import("@/app/api/connectors/[provider]/callback/route");
    const res = await callback.GET(
      new Request(`${APP}/api/connectors/mock/callback?state=abc&code=mock-code`),
      params("mock"),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(
      "/api/connectors/mock/callback?state=abc&code=mock-code",
    );
  });

  it("turns callback failures into a readable ?error= on the settings page", async () => {
    const callback = await import("@/app/api/connectors/[provider]/callback/route");
    const { request } = await signedIn();
    const noAttempt = await callback.GET(
      request("/api/connectors/mock/callback?state=x&code=mock-code"),
      params("mock"),
    );
    expect(noAttempt.status).toBe(303);
    const target = new URL(noAttempt.headers.get("location") ?? "");
    expect(target.pathname).toBe("/settings/connections");
    expect(target.searchParams.get("error")).toMatch(/^mock:/);

    const unknown = await callback.GET(request("/api/connectors/nope/callback"), params("nope"));
    expect(new URL(unknown.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "nope:unknown_provider",
    );
  });

  it("answers 404 for unknown providers, 503 when unconfigured, 402 below Pro", async () => {
    const start = await import("@/app/api/connectors/[provider]/start/route");
    const provider = await import("@/app/api/connectors/[provider]/route");
    const { user, request } = await signedIn();

    expect(
      (await start.POST(request("/api/connectors/nope/start", { method: "POST" }), params("nope")))
        .status,
    ).toBe(404);
    expect(
      (await provider.DELETE(request("/api/connectors/nope", { method: "DELETE" }), params("nope")))
        .status,
    ).toBe(404);

    const google = await start.POST(
      request("/api/connectors/google/start", { method: "POST" }),
      params("google"),
    );
    expect(google.status).toBe(503);
    expect(await google.json()).toMatchObject({
      code: "not_configured",
      error: expect.stringContaining("Google"),
    });

    await getTestRepos().entitlements.upsert(user.id, emptySnapshot());
    const free = await start.POST(
      request("/api/connectors/mock/start", { method: "POST" }),
      params("mock"),
    );
    expect(free.status).toBe(402);
    expect(await free.json()).toMatchObject({ code: "pro_required" });
  });

  it("builds the callback on the request origin off production and on the canonical URL on it", async () => {
    const { callbackOrigin } = await import("@/lib/connectors/http");
    expect(callbackOrigin(new Request("https://sifty-git-branch.vercel.app/api/x"))).toBe(
      "https://sifty-git-branch.vercel.app",
    );
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sifty-app.vercel.app/");
    expect(callbackOrigin(new Request("https://sifty-app-abc.vercel.app/api/x"))).toBe(
      "https://sifty-app.vercel.app",
    );
  });
});
