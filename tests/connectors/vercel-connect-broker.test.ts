import { ConnectionNotReadyError } from "@/lib/connectors/broker";
import {
  setConnectSdkForTesting,
  vercelConnectBroker,
} from "@/lib/connectors/brokers/vercel-connect";
import { getProvider } from "@/lib/connectors/providers";
import type { ConnectionRecord } from "@/lib/db/repos/types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The broker against a stubbed `@vercel/connect`: what we send Connect
 * (subject = the Sifty user id, requested scopes, our callback with the
 * state) and how its errors map onto the connection lifecycle. The real
 * SDK needs a project OIDC token, so the live path is exercised only on
 * Vercel.
 */

class UserAuthorizationRequiredError extends Error {}
class NoValidTokenError extends Error {}

function row(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: "conn_1",
    userId: "user_42",
    provider: "linear",
    broker: "vercel-connect",
    status: "connected",
    connectorUid: "linear/sifty",
    scopes: ["read", "write"],
    externalAccount: null,
    authState: null,
    encryptedSecret: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("vercel-connect broker", () => {
  afterEach(() => setConnectSdkForTesting(null));

  it("reads the connector UID from the provider's env var", () => {
    const spec = getProvider("linear");
    expect(vercelConnectBroker.connectorUid(spec)).toBeNull();
    vi.stubEnv("CONNECTOR_LINEAR", " linear/sifty ");
    expect(vercelConnectBroker.connectorUid(spec)).toBe("linear/sifty");
  });

  it("starts authorization for the user subject with scopes and our stateful callback", async () => {
    vi.stubEnv("CONNECTOR_LINEAR", "linear/sifty");
    const startAuthorization = vi.fn(async () => ({
      url: "https://vercel.com/connect/authorize/abc",
      request: "req",
      verifier: "v",
    }));
    setConnectSdkForTesting({ startAuthorization } as never);
    const res = await vercelConnectBroker.start({
      spec: getProvider("linear"),
      userId: "user_42",
      state: "st4te",
      callbackUrl: "https://sifty-app.vercel.app/api/connectors/linear/callback",
      scopes: ["read", "write"],
    });
    expect(res.url).toBe("https://vercel.com/connect/authorize/abc");
    expect(startAuthorization).toHaveBeenCalledWith(
      "linear/sifty",
      { subject: { type: "user", id: "user_42" }, scopes: ["read", "write"] },
      { callbackUrl: "https://sifty-app.vercel.app/api/connectors/linear/callback?state=st4te" },
    );
  });

  it("omits scopes for integration-mode providers (GitHub App, Notion integration)", async () => {
    vi.stubEnv("CONNECTOR_GITHUB", "github/sifty");
    const startAuthorization = vi.fn(async (..._args: unknown[]) => ({
      url: "https://x",
      request: "r",
      verifier: "v",
    }));
    setConnectSdkForTesting({ startAuthorization } as never);
    await vercelConnectBroker.start({
      spec: getProvider("github"),
      userId: "user_42",
      state: "s",
      callbackUrl: "https://sifty-app.vercel.app/api/connectors/github/callback",
      scopes: ["issues:read"],
    });
    expect(startAuthorization.mock.calls[0]?.[1]).toEqual({
      subject: { type: "user", id: "user_42" },
    });
  });

  it("refuses to start when the provider is not configured", async () => {
    setConnectSdkForTesting({ startAuthorization: vi.fn() } as never);
    await expect(
      vercelConnectBroker.start({
        spec: getProvider("slack"),
        userId: "u",
        state: "s",
        callbackUrl: "https://x/cb",
        scopes: [],
      }),
    ).rejects.toBeInstanceOf(ConnectionNotReadyError);
  });

  it("confirms the grant on callback and reads the account label from claims", async () => {
    const getTokenResponse = vi.fn(async () => ({
      token: "sk-live-provider-token",
      expiresAt: Date.now() + 3600_000,
      connector: { id: "scl_1", uid: "linear/sifty", type: "oauth" },
      claims: { email: "ana@example.com" },
    }));
    setConnectSdkForTesting({
      getTokenResponse,
      UserAuthorizationRequiredError,
      NoValidTokenError,
    } as never);
    const result = await vercelConnectBroker.complete({
      spec: getProvider("linear"),
      userId: "user_42",
      connection: row({ status: "pending" }),
      query: new URLSearchParams({ state: "s" }),
    });
    expect(result).toEqual({ ok: true, externalAccount: "ana@example.com" });
    // The callback never hands the token up to the service.
    expect(JSON.stringify(result)).not.toContain("sk-live");
    expect(getTokenResponse).toHaveBeenCalledWith(
      "linear/sifty",
      { subject: { type: "user", id: "user_42" } },
      { forceRefresh: true },
    );
  });

  it("reports a provider error or an unfinished authorization as a failed callback", async () => {
    setConnectSdkForTesting({
      getTokenResponse: vi.fn(async () => {
        throw new UserAuthorizationRequiredError("nope");
      }),
      UserAuthorizationRequiredError,
      NoValidTokenError,
    } as never);
    const spec = getProvider("linear");
    expect(
      await vercelConnectBroker.complete({
        spec,
        userId: "user_42",
        connection: row(),
        query: new URLSearchParams({ error: "access_denied", error_description: "user_cancel" }),
      }),
    ).toEqual({ ok: false, reason: "access_denied: user_cancel" });
    expect(
      await vercelConnectBroker.complete({
        spec,
        userId: "user_42",
        connection: row(),
        query: new URLSearchParams(),
      }),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("did not complete") });
  });

  it("maps a lost grant to ConnectionNotReadyError and a missing OIDC token to a clear message", async () => {
    setConnectSdkForTesting({
      getTokenResponse: vi.fn(async () => {
        throw new NoValidTokenError("no token");
      }),
      UserAuthorizationRequiredError,
      NoValidTokenError,
    } as never);
    const spec = getProvider("linear");
    await expect(vercelConnectBroker.getToken(row(), spec)).rejects.toBeInstanceOf(
      ConnectionNotReadyError,
    );
    expect(await vercelConnectBroker.health(row(), spec)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Reconnect"),
    });

    setConnectSdkForTesting({
      getTokenResponse: vi.fn(async () => {
        throw new Error("VERCEL_OIDC_TOKEN is not set");
      }),
      UserAuthorizationRequiredError,
      NoValidTokenError,
    } as never);
    await expect(vercelConnectBroker.getToken(row(), spec)).rejects.toThrow(/vercel env pull/);
  });

  it("revokes with the same subject and tolerates an unconfigured provider", async () => {
    const revokeToken = vi.fn(async () => undefined);
    setConnectSdkForTesting({ revokeToken } as never);
    await vercelConnectBroker.revoke(row(), getProvider("linear"));
    expect(revokeToken).toHaveBeenCalledWith("linear/sifty", {
      subject: { type: "user", id: "user_42" },
    });
    await vercelConnectBroker.revoke(row({ connectorUid: null }), getProvider("linear"));
    expect(revokeToken).toHaveBeenCalledTimes(1);
  });
});
