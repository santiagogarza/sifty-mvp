import type { ConnectionRecord } from "@/lib/db/repos/types";
import {
  type BrokerCompleteInput,
  type BrokerCompleteResult,
  type BrokerHealth,
  type BrokerStartInput,
  type BrokerStartResult,
  type BrokerToken,
  ConnectionNotReadyError,
  type CredentialBroker,
} from "../broker";
import { type ConnectorProviderSpec, connectorUidFor } from "../providers";

/**
 * Vercel Connect as the credential broker.
 *
 * Per provider Santi creates one connector (`vercel connect create google
 * --name sifty` → UID `google/sifty`), attaches it to `sifty-app`, and puts
 * the UID in `CONNECTOR_GOOGLE`. From then on:
 *
 * - connect: `startAuthorization()` with the user's Sifty id as the Connect
 *   subject returns the consent URL; Connect runs the provider's OAuth
 *   dance against its own redirect URI and sends the browser back to our
 *   `callbackUrl`.
 * - use: `getTokenResponse()` returns a short-lived access token; Connect
 *   holds and rotates the refresh token. We never see it.
 * - disconnect: `revokeToken()` drops the grant on Connect's side.
 *
 * The SDK authenticates with the deployment's OIDC token (`VERCEL_OIDC_TOKEN`,
 * automatic on Vercel; `vercel env pull` locally), so an unconfigured
 * machine fails with a message that says exactly that.
 *
 * The SDK is imported lazily: nothing here runs in tests or when no
 * provider is configured.
 */

type ConnectSdk = typeof import("@vercel/connect");

let sdkPromise: Promise<ConnectSdk> | null = null;
function sdk(): Promise<ConnectSdk> {
  sdkPromise ??= import("@vercel/connect");
  return sdkPromise;
}

/** Test seam: swap the SDK module for a stub. */
export function setConnectSdkForTesting(stub: Partial<ConnectSdk> | null): void {
  sdkPromise = stub ? Promise.resolve(stub as ConnectSdk) : null;
}

function subjectFor(userId: string) {
  return { type: "user" as const, id: userId };
}

function requireUid(connection: ConnectionRecord, spec: ConnectorProviderSpec): string {
  const uid = connection.connectorUid ?? connectorUidFor(spec);
  if (!uid) {
    throw new ConnectionNotReadyError(
      `${spec.name} is not configured on this deployment (${spec.connectorEnv} is unset).`,
    );
  }
  return uid;
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (/VERCEL_OIDC_TOKEN|oidc/i.test(err.message)) {
      return "Vercel Connect needs the project's OIDC token. On Vercel it is automatic; locally run `vercel link` then `vercel env pull`.";
    }
    return err.message;
  }
  return String(err);
}

async function isAuthorizationError(err: unknown): Promise<boolean> {
  const { UserAuthorizationRequiredError, NoValidTokenError } = await sdk();
  return err instanceof UserAuthorizationRequiredError || err instanceof NoValidTokenError;
}

export const vercelConnectBroker: CredentialBroker = {
  id: "vercel-connect",

  connectorUid(spec) {
    return connectorUidFor(spec);
  },

  async start(input: BrokerStartInput): Promise<BrokerStartResult> {
    const uid = connectorUidFor(input.spec);
    if (!uid) throw new ConnectionNotReadyError(`${input.spec.name} is not configured.`);
    const { startAuthorization } = await sdk();
    const callback = new URL(input.callbackUrl);
    callback.searchParams.set("state", input.state);
    try {
      const res = await startAuthorization(
        uid,
        {
          subject: subjectFor(input.userId),
          ...(input.spec.scopeMode === "oauth" ? { scopes: input.scopes } : {}),
        },
        { callbackUrl: callback.toString() },
      );
      return { url: res.url };
    } catch (err) {
      throw new Error(describe(err), { cause: err });
    }
  },

  async complete(input: BrokerCompleteInput): Promise<BrokerCompleteResult> {
    const error = input.query.get("error");
    if (error) {
      const detail = input.query.get("error_description");
      return { ok: false, reason: detail ? `${error}: ${detail}` : error };
    }
    const uid = requireUid(input.connection, input.spec);
    const { getTokenResponse } = await sdk();
    try {
      // forceRefresh: confirm the grant with Connect rather than trusting
      // a cached token from an earlier attempt.
      const res = await getTokenResponse(
        uid,
        { subject: subjectFor(input.userId) },
        { forceRefresh: true },
      );
      const claims = (res.claims ?? {}) as Record<string, unknown>;
      const metadata = (res.metadata ?? {}) as Record<string, unknown>;
      const account = [
        claims.email,
        metadata.email,
        metadata.team_name,
        metadata.workspace_name,
        res.externalSubject,
      ].find((v): v is string => typeof v === "string" && v.length > 0);
      return { ok: true, externalAccount: account ?? null };
    } catch (err) {
      if (await isAuthorizationError(err)) {
        return {
          ok: false,
          stillPending: true,
          reason: "The provider has not completed the authorization yet.",
        };
      }
      return { ok: false, reason: describe(err) };
    }
  },

  async getToken(connection, spec): Promise<BrokerToken> {
    const uid = requireUid(connection, spec);
    const { getTokenResponse } = await sdk();
    try {
      const res = await getTokenResponse(uid, { subject: subjectFor(connection.userId) });
      return { token: res.token, expiresAt: res.expiresAt ?? null };
    } catch (err) {
      if (await isAuthorizationError(err)) throw new ConnectionNotReadyError();
      throw new Error(describe(err), { cause: err });
    }
  },

  async revoke(connection, spec): Promise<void> {
    const uid = connection.connectorUid ?? connectorUidFor(spec);
    if (!uid) return;
    const { revokeToken } = await sdk();
    await revokeToken(uid, { subject: subjectFor(connection.userId) });
  },

  async health(connection, spec): Promise<BrokerHealth> {
    const uid = connection.connectorUid ?? connectorUidFor(spec);
    if (!uid) return { ok: false, reason: `${spec.connectorEnv} is unset on this deployment.` };
    const { getTokenResponse } = await sdk();
    try {
      const res = await getTokenResponse(
        uid,
        { subject: subjectFor(connection.userId) },
        { forceRefresh: true },
      );
      return { ok: true, expiresAt: res.expiresAt ?? null };
    } catch (err) {
      if (await isAuthorizationError(err)) {
        return { ok: false, reason: "The grant was revoked or expired. Reconnect to continue." };
      }
      return { ok: false, reason: describe(err) };
    }
  },
};
