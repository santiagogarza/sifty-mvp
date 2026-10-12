import { randomBytes } from "node:crypto";
import { encryptSecret } from "@/lib/crypto/aes-gcm";
import { getRepos } from "@/lib/db/repos";
import type {
  ConnectionRecord,
  ConnectionStatus,
  ConnectorProvider,
  Repos,
} from "@/lib/db/repos/types";
import type { Entitlement } from "@/lib/domain/types";
import { canUseConnectors, deriveEntitlement } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import type { ToolSet } from "ai";
import { ConnectionNotReadyError, type CredentialBroker } from "./broker";
import { mockBroker } from "./brokers/mock";
import { vercelConnectBroker } from "./brokers/vercel-connect";
import { type ToolKind, buildConnectorTools, describeTools } from "./manifest";
import {
  type ConnectorProviderSpec,
  type ScopeSpec,
  getProvider,
  listProviders,
  mockConnectorEnabled,
  scopeIds,
} from "./providers";
import { manifestFor } from "./tools";

/**
 * Connection lifecycle.
 *
 * connect  → `startConnect` writes a `pending` row with a one-time state
 *            and returns the broker's consent URL.
 *          → `completeConnect` runs on the callback: checks the state,
 *            asks the broker to confirm the grant, seals any credential
 *            the broker hands back, marks the row `connected`.
 * use      → `getAccessToken` is what executors call right before a
 *            provider request; it re-checks the tier cap every time, so a
 *            downgraded account keeps its rows but cannot use them.
 * check    → `checkConnection` asks the broker whether the grant still
 *            works and records the answer on the row.
 * disconnect → `disconnect` revokes at the broker (best effort) and
 *            deletes the row; any sealed secret goes with it.
 *
 * Every function takes the session's `userId` and scopes repo calls by it;
 * nothing here accepts a user id from a request body.
 */

export type ConnectorErrorCode =
  | "unknown_provider"
  | "not_configured"
  | "pro_required"
  | "not_connected"
  | "state_mismatch"
  | "broker_error";

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number;

  constructor(code: ConnectorErrorCode, status: number, message: string) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.status = status;
  }
}

export const PRO_REQUIRED_MESSAGE =
  "Connections are part of Sifty Pro. Upgrade or redeem an invite code to connect your tools.";

export type ConnectorAvailability = "available" | "not_configured" | "pro_required";

export interface ConnectionView {
  provider: ConnectorProvider;
  name: string;
  tagline: string;
  description: string;
  scopes: ScopeSpec[];
  tools: Array<{ name: string; kind: ToolKind }>;
  mcp: boolean;
  availability: ConnectorAvailability;
  status: ConnectionStatus | "disconnected";
  externalAccount: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  /** Env var the operator must set; only shown to the creator. */
  configHint: string | null;
}

export function brokerFor(spec: ConnectorProviderSpec): CredentialBroker {
  return spec.broker === "mock" ? mockBroker : vercelConnectBroker;
}

export function callbackUrlFor(origin: string, provider: ConnectorProvider): string {
  return `${origin.replace(/\/+$/, "")}/api/connectors/${provider}/callback`;
}

/** The provider spec, or a 404 `ConnectorError`; the mock provider only where it is enabled. */
export function resolveProvider(provider: ConnectorProvider): ConnectorProviderSpec {
  if (provider === "mock" && !mockConnectorEnabled()) {
    throw new ConnectorError("unknown_provider", 404, "Unknown provider.");
  }
  return getProvider(provider);
}

async function entitlementFor(repos: Repos, userId: string): Promise<Entitlement> {
  const [user, snapshot] = await Promise.all([
    repos.users.getById(userId),
    repos.entitlements.get(userId),
  ]);
  return deriveEntitlement({ profile: { isCreator: user?.isCreator ?? false }, snapshot });
}

/** Tier gate. 402 like the sift cap: the user has an upgrade path. */
export async function assertConnectorsAllowed(
  userId: string,
  repos: Repos = getRepos(),
): Promise<Entitlement> {
  const ent = await entitlementFor(repos, userId);
  if (!canUseConnectors(ent)) {
    throw new ConnectorError("pro_required", 402, PRO_REQUIRED_MESSAGE);
  }
  return ent;
}

function viewOf(
  spec: ConnectorProviderSpec,
  row: ConnectionRecord | null,
  opts: { allowed: boolean; isCreator: boolean },
): ConnectionView {
  const configured = brokerFor(spec).connectorUid(spec) !== null;
  const availability: ConnectorAvailability = !configured
    ? "not_configured"
    : !opts.allowed
      ? "pro_required"
      : "available";
  const manifest = manifestFor(spec.id);
  return {
    provider: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    description: spec.description,
    scopes: spec.scopes,
    tools: describeTools(manifest),
    mcp: manifest.mcp !== null,
    availability,
    status: row?.status ?? "disconnected",
    externalAccount: row?.externalAccount ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastError: row?.lastError ?? null,
    connectedAt: row?.status === "connected" ? row.updatedAt : null,
    configHint: opts.isCreator && !configured ? spec.connectorEnv : null,
  };
}

export async function listConnectionViews(
  userId: string,
  opts: { isCreator: boolean },
  repos: Repos = getRepos(),
): Promise<{ allowed: boolean; providers: ConnectionView[] }> {
  const [ent, rows] = await Promise.all([
    entitlementFor(repos, userId),
    repos.connections.list(userId),
  ]);
  const allowed = canUseConnectors(ent);
  const byProvider = new Map(rows.map((r) => [r.provider, r] as const));
  return {
    allowed,
    providers: listProviders().map((spec) =>
      viewOf(spec, byProvider.get(spec.id) ?? null, { allowed, isCreator: opts.isCreator }),
    ),
  };
}

export async function startConnect(
  userId: string,
  provider: ConnectorProvider,
  opts: { origin: string },
  repos: Repos = getRepos(),
): Promise<{ url: string }> {
  const spec = resolveProvider(provider);
  await assertConnectorsAllowed(userId, repos);
  const broker = brokerFor(spec);
  const connectorUid = broker.connectorUid(spec);
  if (!connectorUid) {
    throw new ConnectorError(
      "not_configured",
      503,
      `${spec.name} is not set up on this deployment yet (${spec.connectorEnv} is unset).`,
    );
  }
  const state = randomBytes(18).toString("base64url");
  const scopes = scopeIds(spec);
  // A restart replaces the previous attempt; a `connected` row is replaced
  // too, so "Reconnect" re-runs consent instead of layering on a dead grant.
  await repos.connections.upsert(userId, provider, {
    broker: broker.id,
    status: "pending",
    connectorUid,
    scopes,
    authState: state,
  });
  try {
    return await broker.start({
      spec,
      userId,
      state,
      callbackUrl: callbackUrlFor(opts.origin, provider),
      scopes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repos.connections.update(userId, provider, {
      status: "error",
      authState: null,
      lastError: message,
    });
    reportError(err, { area: "connectors.start", userId, tags: { provider } });
    throw new ConnectorError("broker_error", 502, message);
  }
}

export type CompleteResult =
  | { ok: true; connection: ConnectionRecord }
  | { ok: false; code: ConnectorErrorCode | "denied"; reason: string };

export async function completeConnect(
  userId: string,
  provider: ConnectorProvider,
  query: URLSearchParams,
  repos: Repos = getRepos(),
): Promise<CompleteResult> {
  const spec = resolveProvider(provider);
  try {
    await assertConnectorsAllowed(userId, repos);
  } catch (err) {
    if (err instanceof ConnectorError) return { ok: false, code: err.code, reason: err.message };
    throw err;
  }
  const row = await repos.connections.get(userId, provider);
  if (!row || row.status !== "pending") {
    return { ok: false, code: "not_connected", reason: "No connection attempt is in progress." };
  }
  const state = query.get("state");
  // Vercel Connect may not echo our query back; the mock always does. When
  // a state is present it must be ours, so a stale or foreign callback
  // cannot complete a different attempt.
  if (state && state !== row.authState) {
    return {
      ok: false,
      code: "state_mismatch",
      reason: "This link does not match the connection attempt.",
    };
  }
  if (spec.broker === "mock" && !state) {
    return { ok: false, code: "state_mismatch", reason: "Missing state." };
  }

  const broker = brokerFor(spec);
  const result = await broker.complete({ spec, userId, connection: row, query });
  if (!result.ok) {
    // Only a callback bound to this attempt's state may end it; an unbound
    // hit during the consent window must leave the real redirect a pending row.
    if (state) {
      await repos.connections.update(userId, provider, {
        status: "error",
        authState: null,
        lastError: result.reason,
      });
    }
    return { ok: false, code: "denied", reason: result.reason };
  }
  const connection = await repos.connections.update(userId, provider, {
    status: "connected",
    authState: null,
    scopes: result.scopes ?? row.scopes,
    externalAccount: result.externalAccount,
    encryptedSecret: result.secret ? encryptSecret(result.secret, row.id) : null,
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
  });
  if (!connection)
    return { ok: false, code: "not_connected", reason: "The connection disappeared." };
  return { ok: true, connection };
}

export async function disconnect(
  userId: string,
  provider: ConnectorProvider,
  repos: Repos = getRepos(),
): Promise<boolean> {
  const spec = resolveProvider(provider);
  const row = await repos.connections.get(userId, provider);
  if (!row) return false;
  // Revoke in every state: an `error` or `pending` row can still sit on top
  // of a live grant at the broker.
  try {
    await brokerFor(spec).revoke(row, spec);
  } catch (err) {
    // The row goes regardless: a grant we can no longer reach is still
    // unusable without the reference, and the user asked for it gone.
    reportError(err, { area: "connectors.disconnect", userId, tags: { provider } });
  }
  return repos.connections.delete(userId, provider);
}

export async function checkConnection(
  userId: string,
  provider: ConnectorProvider,
  repos: Repos = getRepos(),
): Promise<ConnectionRecord> {
  const spec = resolveProvider(provider);
  const row = await repos.connections.get(userId, provider);
  if (!row || row.status === "pending") {
    throw new ConnectorError("not_connected", 409, `${spec.name} is not connected.`);
  }
  const health = await brokerFor(spec).health(row, spec);
  const updated = await repos.connections.update(userId, provider, {
    status: health.ok ? "connected" : "error",
    lastCheckedAt: new Date().toISOString(),
    lastError: health.ok ? null : health.reason,
  });
  return updated ?? row;
}

/**
 * Short-lived provider token for one call. Executors call this through
 * `buildConnectorTools`, never cache it across steps, and never log it.
 */
export async function getAccessToken(
  userId: string,
  provider: ConnectorProvider,
  repos: Repos = getRepos(),
): Promise<string> {
  const spec = resolveProvider(provider);
  await assertConnectorsAllowed(userId, repos);
  const row = await repos.connections.get(userId, provider);
  if (!row || row.status !== "connected") {
    throw new ConnectorError("not_connected", 409, `${spec.name} is not connected.`);
  }
  try {
    const { token } = await brokerFor(spec).getToken(row, spec);
    return token;
  } catch (err) {
    if (err instanceof ConnectionNotReadyError) {
      await repos.connections.update(userId, provider, { status: "error", lastError: err.message });
      throw new ConnectorError("not_connected", 409, `${spec.name}: ${err.message}`);
    }
    throw err;
  }
}

/** Providers the user has in `connected` state. */
export async function connectedProviders(
  userId: string,
  repos: Repos = getRepos(),
): Promise<ConnectorProvider[]> {
  const rows = await repos.connections.list(userId);
  return rows
    .filter((r) => r.status === "connected")
    .map((r) => r.provider)
    .filter((p) => p !== "mock" || mockConnectorEnabled());
}

/**
 * AI SDK tools over every connected provider, filtered by kind. The
 * executor passes `read` for research loops and `all` only inside a
 * `draft_then_approve` step.
 */
export async function connectorToolsFor(
  userId: string,
  opts: { allow: ToolKind | "all"; providers?: ConnectorProvider[]; fetch?: typeof fetch },
  repos: Repos = getRepos(),
): Promise<ToolSet> {
  const connected = await connectedProviders(userId, repos);
  const chosen = opts.providers ? connected.filter((p) => opts.providers?.includes(p)) : connected;
  return buildConnectorTools({
    userId,
    manifests: chosen.map(manifestFor),
    allow: opts.allow,
    getToken: (provider) => getAccessToken(userId, provider, repos),
    fetch: opts.fetch,
  });
}
